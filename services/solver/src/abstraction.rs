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
}

pub fn parse_action_set(raw: &[String], effective_stack_bb: f64) -> Vec<ActionSpec> {
    if raw.is_empty() {
        return Vec::new();
    }

    raw.iter()
        .map(|value| match value.as_str() {
            "all-in" => ActionSpec {
                label: "all-in".to_string(),
                amount: effective_stack_bb.max(1.0),
            },
            other => {
                let parsed = other.parse::<f64>().unwrap_or_default();
                ActionSpec {
                    label: other.to_string(),
                    amount: parsed,
                }
            }
        })
        .collect()
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
