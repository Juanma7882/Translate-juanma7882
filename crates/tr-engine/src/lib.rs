//! Composition root: elige adaptadores según la configuración y arma los pipelines.

#![forbid(unsafe_code)]

mod engine;
pub mod fake;
mod models;
mod real;

pub use engine::{Engine, EngineConfig, EngineKind};
pub use models::{Catalog, ModelScope, ModelStatus, Models};
pub use tr_core;
pub use tr_models::{Manifest, ModelState};
