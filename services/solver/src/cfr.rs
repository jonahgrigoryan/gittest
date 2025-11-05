use crate::game_tree::GameTree;

#[derive(Clone, Debug)]
pub struct ActionStat {
    pub label: String,
    pub amount: f64,
    pub frequency: f64,
    pub ev: f64,
    pub regret: f64,
}

pub fn run_cfr(tree: &GameTree, iterations: usize) -> Vec<ActionStat> {
    if tree.is_empty() {
        return Vec::new();
    }

    let iterations = iterations.max(1) as f64;
    let count = tree.actions.len() as f64;
    let base_frequency = 1.0 / count;

    let mut raw_freqs = Vec::with_capacity(tree.actions.len());
    let mut total = 0.0;
    for (index, _) in tree.actions.iter().enumerate() {
        let modulation = 1.0 - (index as f64 * 0.05);
        let freq = (base_frequency * modulation).max(0.0);
        total += freq;
        raw_freqs.push(freq);
    }

    if total <= f64::EPSILON {
        total = count;
        raw_freqs.iter_mut().for_each(|freq| *freq = 1.0);
    }

    tree.actions
        .iter()
        .enumerate()
        .map(|(index, action)| {
            let modulation = 1.0 - (index as f64 * 0.05);
            let normalized_frequency = (raw_freqs[index] / total).clamp(0.0, 1.0);
            let ev = (tree.effective_stack_bb.max(1.0) / 100.0) * modulation.max(0.1);
            let regret = ((iterations - 1.0) / iterations) * (0.1 - index as f64 * 0.01).max(0.0);

            ActionStat {
                label: action.label.clone(),
                amount: action.amount,
                frequency: normalized_frequency,
                ev,
                regret,
            }
        })
        .collect()
}
