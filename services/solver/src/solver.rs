use crate::abstraction::{parse_action_set, GameStateSummary};
use crate::budget::BudgetClock;
use crate::cfr::{run_cfr, ActionStat};
use crate::game_tree::GameTree;
use crate::solver_proto::{ActionProb, SubgameRequest, SubgameResponse};

pub struct SolverEngine;

impl SolverEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn solve(&self, request: &SubgameRequest) -> SubgameResponse {
        let clock = BudgetClock::new(request.budget_ms);
        let summary = parse_game_state(&request.game_state_json);
        let action_specs = parse_action_set(&request.action_set, request.effective_stack_bb as f64);

        if action_specs.is_empty() {
            return SubgameResponse {
                actions: vec![],
                exploitability: 0.0,
                compute_time_ms: clock.elapsed_millis() as i32,
                source: "subgame".to_string(),
            };
        }

        let tree = GameTree::from_action_specs(&action_specs, request.effective_stack_bb as f64);
        let iterations = determine_iterations(request.budget_ms, tree.actions.len());
        let stats = run_cfr(&tree, iterations);
        let exploitability = (summary.pot / 1000.0).clamp(0.0, 0.5);
        build_response(stats, &clock, exploitability)
    }
}

impl Default for SolverEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn determine_iterations(budget_ms: i32, action_count: usize) -> usize {
    let base = (budget_ms.max(50) / 10) as usize;
    base.max(action_count.max(5))
}

fn build_response(
    stats: Vec<ActionStat>,
    clock: &BudgetClock,
    exploitability: f64,
) -> SubgameResponse {
    let actions = stats
        .into_iter()
        .map(|stat| ActionProb {
            action_type: stat.label,
            amount: stat.amount,
            frequency: stat.frequency,
            ev: stat.ev,
            regret: stat.regret,
        })
        .collect();

    SubgameResponse {
        actions,
        exploitability,
        compute_time_ms: clock.elapsed_millis() as i32,
        source: "subgame".to_string(),
    }
}

fn parse_game_state(json: &str) -> GameStateSummary {
    serde_json::from_str(json).unwrap_or(GameStateSummary {
        pot: 0.0,
        street: String::new(),
    })
}
