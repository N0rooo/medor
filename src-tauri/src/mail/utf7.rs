//! Encodage « UTF-7 modifié » des noms de boîtes IMAP (RFC 3501 §5.1.3).
//!
//! Les serveurs IMAP (Gmail inclus) exigent que les caractères hors ASCII
//! imprimable soient encodés en base64 UTF-16BE entre `&` et `-`, avec `,` à
//! la place de `/`, et que `&` littéral devienne `&-`.
//! Ex. : « Réseaux sociaux » → `R&AOk-seaux sociaux`.

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;

pub fn encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    let mut pending: Vec<u16> = Vec::new();

    fn flush(out: &mut String, pending: &mut Vec<u16>) {
        if pending.is_empty() {
            return;
        }
        let mut bytes = Vec::with_capacity(pending.len() * 2);
        for unit in pending.iter() {
            bytes.push((unit >> 8) as u8);
            bytes.push((unit & 0xff) as u8);
        }
        let b64 = STANDARD_NO_PAD.encode(&bytes).replace('/', ",");
        out.push('&');
        out.push_str(&b64);
        out.push('-');
        pending.clear();
    }

    for c in input.chars() {
        if c == '&' {
            flush(&mut out, &mut pending);
            out.push_str("&-");
        } else if (' '..='~').contains(&c) {
            flush(&mut out, &mut pending);
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                pending.push(*unit);
            }
        }
    }
    flush(&mut out, &mut pending);
    out
}

/// Décodage inverse : nom IMAP « UTF-7 modifié » → chaîne lisible.
pub fn decode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c != '&' {
            out.push(c);
            continue;
        }
        let mut b64 = String::new();
        for n in chars.by_ref() {
            if n == '-' {
                break;
            }
            b64.push(n);
        }
        if b64.is_empty() {
            // « &- » est un « & » littéral.
            out.push('&');
            continue;
        }
        let std_b64 = b64.replace(',', "/");
        if let Ok(bytes) = STANDARD_NO_PAD.decode(std_b64) {
            let units: Vec<u16> = bytes
                .chunks(2)
                .filter(|c| c.len() == 2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            out.push_str(&String::from_utf16_lossy(&units));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{decode, encode};

    #[test]
    fn ascii_simple_inchange() {
        assert_eq!(encode("Newsletters"), "Newsletters");
        assert_eq!(encode("Dev outils"), "Dev outils");
    }

    #[test]
    fn esperluette_litterale() {
        assert_eq!(encode("Banque & finance"), "Banque &- finance");
    }

    #[test]
    fn accents_en_utf7() {
        assert_eq!(encode("Réseaux sociaux"), "R&AOk-seaux sociaux");
        assert_eq!(encode("Boîte"), "Bo&AO4-te");
        assert_eq!(encode("Indésirables"), "Ind&AOk-sirables");
    }

    #[test]
    fn accents_et_esperluette() {
        assert_eq!(encode("Sécurité & comptes"), "S&AOk-curit&AOk- &- comptes");
    }

    #[test]
    fn delimiteur_conserve() {
        assert_eq!(encode("Voyages & réservations/SNCF"), "Voyages &- r&AOk-servations/SNCF");
    }

    #[test]
    fn aller_retour() {
        for s in ["Réseaux sociaux", "Banque & finance", "Sécurité & comptes/Apple", "Boîte"] {
            assert_eq!(decode(&encode(s)), s);
        }
    }
}
