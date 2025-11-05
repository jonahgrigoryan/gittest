use crate::abstraction::ActionSpec;

#[derive(Clone, Debug)]
pub struct GameTreeAction {
    pub label: String,
    pub amount: f64,
}

#[derive(Clone, Debug)]
pub struct GameTree {
    pub actions: Vec<GameTreeAction>,
    pub effective_stack_bb: f64,
}

impl GameTree {
    pub fn from_action_specs(specs: &[ActionSpec], effective_stack_bb: f64) -> Self {
        let mut actions = Vec::with_capacity(specs.len());
        for spec in specs {
            let amount = if spec.amount <= 0.0 {
                effective_stack_bb.max(1.0)
            } else {
                spec.amount.min(effective_stack_bb.max(1.0))
            };
            actions.push(GameTreeAction {
                label: spec.label.clone(),
                amount,
            });
        }

        Self {
            actions,
            effective_stack_bb,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.actions.is_empty()
    }
}
