use solver::solver::SolverEngine;
use solver::solver_proto::solver_server::{Solver, SolverServer};
use solver::solver_proto::{SubgameRequest, SubgameResponse};
use tonic::{Request, Response, Status};

#[derive(Default)]
struct SolverService {
    engine: SolverEngine,
}

#[tonic::async_trait]
impl Solver for SolverService {
    async fn solve(
        &self,
        request: Request<SubgameRequest>,
    ) -> Result<Response<SubgameResponse>, Status> {
        let response = self.engine.solve(&request.into_inner());
        Ok(Response::new(response))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "127.0.0.1:50051".parse()?;
    let service = SolverService::default();
    println!("Solver listening on {}", addr);
    tonic::transport::Server::builder()
        .add_service(SolverServer::new(service))
        .serve(addr)
        .await?;
    Ok(())
}
