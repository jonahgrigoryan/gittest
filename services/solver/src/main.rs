mod solver {
    tonic::include_proto!("solver");
}

use solver::solver_server::{Solver, SolverServer};
use solver::{SubgameRequest, SubgameResponse};
use tonic::{Request, Response, Status};

#[derive(Default)]
struct MySolver;

#[tonic::async_trait]
impl Solver for MySolver {
    async fn solve(&self, _request: Request<SubgameRequest>) -> Result<Response<SubgameResponse>, Status> {
        let reply = SubgameResponse { actions: vec!["fold".into()], probabilities: vec![1.0] };
        Ok(Response::new(reply))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "127.0.0.1:50051".parse()?;
    let svc = SolverServer::new(MySolver::default());
    println!("Solver listening on {}", addr);
    tonic::transport::Server::builder().add_service(svc).serve(addr).await?;
    Ok(())
}
