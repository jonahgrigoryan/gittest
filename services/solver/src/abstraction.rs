use serde::Deserialize;

#[derive(Clone, Debug, PartialEq)]
pub struct ActionSpec {
    pub label: String,
    pub amount: f64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GameStateSummary {
    #[serde(default)]
    pub pot: f64,
    #[serde(default)]
    pub street: String,
    #[serde(default)]
    pub blinds: BlindSummary,
}

#[derive(Clone, Debug, Deserialize, Default)]
pub struct BlindSummary {
    #[serde(default)]
    pub big: f64,
}

impl GameStateSummary {
    pub fn pot_in_bb(&self) -> f64 {
        let big_blind = self.blinds.big.max(1.0);
        let derived = if big_blind > 0.0 {
            self.pot / big_blind
        } else {
            self.pot
        };
        derived.max(1.0)
    }
}

pub fn parse_action_set(
    raw: &[String],
    summary: &GameStateSummary,
    effective_stack_bb: f64,
) -> Vec<ActionSpec> {
    if raw.is_empty() {
        return Vec::new();
    }

    let pot_bb = summary.pot_in_bb();
    let stack_cap = effective_stack_bb.max(1.0);

    raw.iter()
        .filter_map(|value| parse_action_token(value, pot_bb, stack_cap))
        .collect()
}

fn parse_action_token(token: &str, pot_bb: f64, stack_cap: f64) -> Option<ActionSpec> {
    if token.eq_ignore_ascii_case("all-in") {
        return Some(ActionSpec {
            label: "all-in".to_string(),
            amount: stack_cap,
        });
    }

    if let Some(rest) = token.strip_prefix("pot:") {
        let fraction = rest.parse::<f64>().unwrap_or(0.0).max(0.01);
        return Some(ActionSpec {
            label: format!("pot-{:.2}", fraction),
            amount: (fraction * pot_bb).clamp(0.5, stack_cap),
        });
    }

    if let Some(rest) = token.strip_prefix("stack:") {
        let fraction = rest.parse::<f64>().unwrap_or(0.0).clamp(0.0, 1.0);
        return Some(ActionSpec {
            label: format!("stack-{:.2}", fraction),
            amount: (fraction * stack_cap).max(0.5),
        });
    }

    if let Some(rest) = token.strip_prefix("abs:") {
        let value = rest.parse::<f64>().unwrap_or(0.0).max(0.0);
        return Some(ActionSpec {
            label: format!("abs-{:.2}", value),
            amount: value.min(stack_cap),
        });
    }

    // Backwards compatibility: treat plain numbers as absolute BB values.
    if let Ok(value) = token.parse::<f64>() {
        if value > 0.0 {
            return Some(ActionSpec {
                label: format!("abs-{:.2}", value),
                amount: value.min(stack_cap),
            });
        }
    }

    None
}

pub fn bucket_hole_cards(card_codes: &[String]) -> String {
    if card_codes.len() < 2 {
        return "unknown".to_string();
    }
    let mut cards = card_codes.to_vec();
    cards.sort();
    if cards[0].chars().next() == cards[1].chars().next() {
        format!("pair-{}", cards[0].chars().next().unwrap())
    } else {
        let suited = cards
            .iter()
            .all(|card| card.ends_with(card_codes[0].chars().last().unwrap()));
        format!("{}{}{}", cards[0], cards[1], if suited { "s" } else { "o" })
    }
}
