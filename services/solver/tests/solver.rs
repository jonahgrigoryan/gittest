use solver::abstraction::parse_action_set;
use solver::solver::SolverEngine;
use solver::solver_proto::SubgameRequest;

#[test]
fn parses_action_set() {
    let specs = parse_action_set(&["0.5".to_string(), "all-in".to_string()], 150.0);
    assert_eq!(specs.len(), 2);
    assert!((specs[0].amount - 0.5).abs() < f64::EPSILON);
    assert_eq!(specs[1].label, "all-in");
    assert_eq!(specs[1].amount, 150.0);
}

#[test]
fn solver_engine_returns_actions() {
    let engine = SolverEngine::new();
    let request = SubgameRequest {
        state_fingerprint: "unit-test".into(),
        game_state_json: serde_json::json!({ "pot": 12.0, "street": "preflop" }).to_string(),
        budget_ms: 200,
        effective_stack_bb: 120,
        action_set: vec!["0.33".into(), "0.75".into(), "all-in".into()],
    };

    let response = engine.solve(&request);
    assert_eq!(response.source, "subgame");
    assert_eq!(response.actions.len(), 3);
    let total_freq: f64 = response.actions.iter().map(|a| a.frequency).sum();
    assert!(total_freq > 0.0);
}
