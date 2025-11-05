use std::time::{Duration, Instant};

pub struct BudgetClock {
    start: Instant,
    budget: Duration,
}

impl BudgetClock {
    pub fn new(budget_ms: i32) -> Self {
        let budget_ms = budget_ms.max(0) as u64;
        Self {
            start: Instant::now(),
            budget: Duration::from_millis(budget_ms),
        }
    }

    pub fn elapsed(&self) -> Duration {
        self.start.elapsed()
    }

    pub fn elapsed_millis(&self) -> u64 {
        self.elapsed().as_millis() as u64
    }

    pub fn remaining_millis(&self) -> u64 {
        if self.budget.is_zero() {
            return 0;
        }
        let elapsed = self.elapsed();
        if elapsed >= self.budget {
            0
        } else {
            (self.budget - elapsed).as_millis() as u64
        }
    }

    pub fn exhausted(&self) -> bool {
        self.budget.is_zero() || self.elapsed() >= self.budget
    }
}
