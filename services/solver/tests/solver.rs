use solver::abstraction::{parse_action_set, BlindSummary, GameStateSummary};
use solver::solver::SolverEngine;
use solver::solver_proto::SubgameRequest;

#[test]
fn parses_action_set() {
    let summary = GameStateSummary {
        pot: 20.0,
        street: "preflop".into(),
        blinds: BlindSummary { big: 2.0 },
    };
    let specs = parse_action_set(
        &["pot:0.5".to_string(), "all-in".to_string()],
        &summary,
        150.0,
    );
    assert_eq!(specs.len(), 2);
    assert!((specs[0].amount - 5.0).abs() < f64::EPSILON);
    assert_eq!(specs[1].label, "all-in");
    assert_eq!(specs[1].amount, 150.0);
}

#[test]
fn solver_engine_returns_actions() {
    let engine = SolverEngine::new();
    let request = SubgameRequest {
        state_fingerprint: "unit-test".into(),
        game_state_json:
            serde_json::json!({ "pot": 12.0, "street": "preflop", "blinds": { "big": 2 } })
                .to_string(),
        budget_ms: 200,
        effective_stack_bb: 120,
        action_set: vec!["pot:0.33".into(), "pot:0.75".into(), "all-in".into()],
    };

    let response = engine.solve(&request);
    assert_eq!(response.source, "subgame");
    assert_eq!(response.actions.len(), 3);
    let total_freq: f64 = response.actions.iter().map(|a| a.frequency).sum();
    assert!(total_freq > 0.0);
}
