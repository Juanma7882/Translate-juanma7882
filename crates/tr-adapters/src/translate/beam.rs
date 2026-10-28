//! Búsqueda por haces (beam search) independiente del modelo.
//!
//! `search` solo conoce un [`Decode`]: algo que, dadas las secuencias vivas, devuelve los logits
//! del siguiente token de cada una. Así se prueba sin ONNX. Con un solo haz es la decodificación
//! voraz de siempre. Sigue el esquema de Hugging Face: `2·k` candidatos por paso, un candidato
//! `</s>` solo cuenta si está entre los `k` mejores, parada anticipada con `k` hipótesis
//! terminadas y puntuación final = logprob / longitud.

use tr_core::Result;

/// Fuente de logits para la búsqueda.
pub(super) trait Decode {
    /// Logits del siguiente token de cada secuencia viva (fila `i` = `hyps[i]`), concatenados:
    /// `hyps.len() * vocab` valores. Devuelve también `vocab`.
    fn step(&mut self, hyps: &[Vec<i64>]) -> Result<(Vec<f32>, usize)>;

    /// La hipótesis `i` de la siguiente llamada desciende de la `parents[i]` de la anterior.
    fn reorder(&mut self, parents: &[usize]) -> Result<()>;
}

pub(super) struct Search {
    pub beams: usize,
    pub max_len: usize,
    /// Id con el que arranca el decoder; nunca se genera.
    pub start: i64,
    pub eos: i64,
}

#[derive(Clone)]
struct Hyp {
    tokens: Vec<i64>,
    score: f32,
}

/// Logprob de los `n` mejores ids de `logits` (`blocked` y NaN excluidos), de mayor a menor;
/// en empate gana el menor id.
fn top_n(logits: &[f32], blocked: i64, n: usize) -> Vec<(f32, usize)> {
    let max = logits
        .iter()
        .copied()
        .filter(|v| !v.is_nan())
        .fold(f32::NEG_INFINITY, f32::max);
    if max == f32::NEG_INFINITY {
        return Vec::new();
    }
    let sum: f32 = logits
        .iter()
        .filter(|v| !v.is_nan())
        .map(|&v| (v - max).exp())
        .sum();
    let log_sum = max + sum.ln();

    let mut best: Vec<(f32, usize)> = Vec::with_capacity(n + 1);
    for (id, &score) in logits.iter().enumerate() {
        if id as i64 == blocked || score.is_nan() {
            continue;
        }
        if best.len() == n && score <= best[n - 1].0 {
            continue;
        }
        let at = best.partition_point(|&(s, _)| s >= score);
        best.insert(at, (score, id));
        best.truncate(n);
    }
    for entry in &mut best {
        entry.0 -= log_sum;
    }
    best
}

/// Mejor secuencia generada (sin el id de arranque ni `</s>`).
pub(super) fn search(config: &Search, decode: &mut dyn Decode) -> Result<Vec<i64>> {
    let k = config.beams.max(1);
    // Los k haces arrancan idénticos; solo el primero cuenta (los demás parten con -inf).
    let mut alive: Vec<Hyp> = (0..k)
        .map(|i| Hyp {
            tokens: vec![config.start],
            score: if i == 0 { 0.0 } else { f32::NEG_INFINITY },
        })
        .collect();
    let mut finished: Vec<Hyp> = Vec::new();

    for _ in 0..config.max_len {
        let sequences: Vec<Vec<i64>> = alive.iter().map(|h| h.tokens.clone()).collect();
        let (logits, vocab) = decode.step(&sequences)?;
        let mut candidates: Vec<(f32, usize, usize)> = Vec::new();
        for (beam, hyp) in alive.iter().enumerate() {
            if hyp.score == f32::NEG_INFINITY {
                continue;
            }
            let row = &logits[beam * vocab..(beam + 1) * vocab];
            for (lp, id) in top_n(row, config.start, 2 * k) {
                candidates.push((hyp.score + lp, beam, id));
            }
        }
        candidates.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.2.cmp(&b.2)).then(a.1.cmp(&b.1)));

        let mut next: Vec<Hyp> = Vec::with_capacity(k);
        let mut parents: Vec<usize> = Vec::with_capacity(k);
        for (rank, &(score, beam, id)) in candidates.iter().take(2 * k).enumerate() {
            let mut tokens = alive[beam].tokens.clone();
            tokens.push(id as i64);
            if id as i64 == config.eos {
                if rank < k {
                    finished.push(Hyp { tokens, score });
                }
            } else if next.len() < k {
                next.push(Hyp { tokens, score });
                parents.push(beam);
            }
        }
        if finished.len() >= k || next.is_empty() {
            break;
        }
        // Rellena hasta k con haces "muertos" para mantener el tamaño del lote.
        while next.len() < k {
            next.push(Hyp {
                tokens: next[0].tokens.clone(),
                score: f32::NEG_INFINITY,
            });
            parents.push(parents[0]);
        }
        decode.reorder(&parents)?;
        alive = next;
    }

    // Sin terminadas (se agotó el límite): las vivas valen como candidatas.
    if finished.is_empty() {
        finished.extend(alive.into_iter().filter(|h| h.score.is_finite()));
    }
    let normalized = |h: &Hyp| h.score / (h.tokens.len() - 1).max(1) as f32;
    let best = finished
        .iter()
        .max_by(|a, b| normalized(a).total_cmp(&normalized(b)))
        .map_or_else(Vec::new, |h| h.tokens.clone());
    Ok(best
        .into_iter()
        .skip(1)
        .filter(|&t| t != config.eos)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Modelo de juguete: la distribución del siguiente token depende solo del último token.
    struct Table {
        vocab: usize,
        /// `rows[último][siguiente]` = logit.
        rows: Vec<Vec<f32>>,
        steps: usize,
        reorders: Vec<Vec<usize>>,
    }

    impl Table {
        fn new(rows: Vec<Vec<f32>>) -> Self {
            Self {
                vocab: rows[0].len(),
                rows,
                steps: 0,
                reorders: Vec::new(),
            }
        }
    }

    impl Decode for Table {
        fn step(&mut self, hyps: &[Vec<i64>]) -> Result<(Vec<f32>, usize)> {
            self.steps += 1;
            let mut out = Vec::new();
            for h in hyps {
                out.extend_from_slice(&self.rows[*h.last().unwrap() as usize]);
            }
            Ok((out, self.vocab))
        }
        fn reorder(&mut self, parents: &[usize]) -> Result<()> {
            self.reorders.push(parents.to_vec());
            Ok(())
        }
    }

    // Ids: 0 = </s>, 1 = A, 2 = B, 3 = C, 4 = arranque.
    const NEG: f32 = -30.0;

    fn config(beams: usize) -> Search {
        Search {
            beams,
            max_len: 10,
            start: 4,
            eos: 0,
        }
    }

    /// Voraz: tras el arranque A es lo mejor (0.6) y luego fin. Con haces: B es 0.4 pero
    /// seguido de C casi seguro (0.9) y fin (0.9), así que B C gana a A fin... (ver abajo).
    fn table() -> Table {
        let row = |p: [f32; 4]| -> Vec<f32> {
            let mut v: Vec<f32> = p
                .iter()
                .map(|x| if *x > 0.0 { x.ln() } else { NEG })
                .collect();
            v.push(NEG); // el id de arranque no se predice
            v
        };
        Table::new(vec![
            row([0.0, 0.0, 0.0, 0.0]),   // 0: </s>
            row([0.55, 0.0, 0.0, 0.45]), // 1: A -> fin 0.55 | C 0.45
            row([0.0, 0.0, 0.0, 0.0]),   // 2: B (sin uso)
            row([0.9, 0.05, 0.05, 0.0]), // 3: C -> fin 0.9
            row([0.0, 0.5, 0.0, 0.5]),   // 4: arranque -> A 0.5 | C 0.5
        ])
    }

    #[test]
    fn one_beam_is_greedy() {
        let mut t = table();
        // arranque: A y C empatan -> gana el menor id (A); luego fin (0.55 > 0.45).
        assert_eq!(search(&config(1), &mut t).unwrap(), [1]);
    }

    #[test]
    fn beams_find_the_higher_scoring_sequence_greedy_misses() {
        // Voraz elige A fin: 0.5 * 0.55 = 0.275. Alternativa C fin: 0.5 * 0.9 = 0.45.
        let mut t = table();
        assert_eq!(search(&config(1), &mut t).unwrap(), [1]);
        let mut t = table();
        assert_eq!(search(&config(2), &mut t).unwrap(), [3]);
        let mut t = table();
        assert_eq!(search(&config(4), &mut t).unwrap(), [3]);
    }

    #[test]
    fn the_start_token_is_never_generated_even_if_it_scores_highest() {
        let mut rows = table().rows;
        rows[4][4] = 100.0;
        let mut t = Table::new(rows);
        let out = search(&config(2), &mut t).unwrap();
        assert!(!out.contains(&4), "{out:?}");
    }

    #[test]
    fn the_length_limit_stops_a_model_that_never_finishes() {
        // El token A se repite siempre: sin fin, se corta en max_len.
        // Con relleno (ids 5..) mejor puntuado que `</s>`, para que este nunca entre entre los k mejores.
        let mut rows = vec![vec![NEG; 12]; 12];
        for row in &mut rows {
            row[5..11].fill(-20.0);
        }
        rows[4][1] = 0.0;
        rows[1][1] = 0.0;
        let mut t = Table::new(rows);
        let out = search(&config(3), &mut t).unwrap();
        assert_eq!(out.len(), 10);
        assert!(out.iter().all(|&x| x == 1));
        assert_eq!(t.steps, 10);
    }

    #[test]
    fn hypotheses_are_reordered_after_each_step_and_batch_size_is_kept() {
        let mut t = table();
        search(&config(3), &mut t).unwrap();
        assert!(!t.reorders.is_empty());
        assert!(t.reorders.iter().all(|p| p.len() == 3));
    }

    #[test]
    fn nothing_to_choose_gives_an_empty_result() {
        let mut t = Table::new(vec![vec![f32::NAN; 5]; 5]);
        assert!(search(&config(2), &mut t).unwrap().is_empty());
    }

    #[test]
    fn top_n_orders_by_score_skips_blocked_and_nan() {
        let top = top_n(&[0.1, 3.0, f32::NAN, 2.0, 3.0], 4, 3);
        let ids: Vec<usize> = top.iter().map(|&(_, id)| id).collect();
        assert_eq!(ids, [1, 3, 0], "empate: el menor id primero; 4 bloqueado");
        let total: f32 = top_n(&[1.0, 2.0, 3.0], -1, 3)
            .iter()
            .map(|&(lp, _)| lp.exp())
            .sum();
        assert!((total - 1.0).abs() < 1e-5, "son logprob de un softmax");
        assert!(top_n(&[f32::NAN], -1, 2).is_empty());
    }
}
