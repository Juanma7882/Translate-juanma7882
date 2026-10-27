//! Composition root: elige adaptadores según la configuración y arma los pipelines.

#![forbid(unsafe_code)]

mod engine;
pub mod fake;

pub use engine::{Engine, EngineConfig, EngineKind};
pub use tr_core;
