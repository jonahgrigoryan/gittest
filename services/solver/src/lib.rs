pub mod solver_proto {
    tonic::include_proto!("solver");
}

pub mod abstraction;
pub mod budget;
pub mod cfr;
pub mod game_tree;
pub mod solver;
