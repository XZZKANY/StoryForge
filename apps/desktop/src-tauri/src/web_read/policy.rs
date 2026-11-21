use reqwest::Url;
use std::net::IpAddr;

pub(super) fn same_site(left: &Url, right: &Url) -> bool {
    let host = |url: &Url| {
        url.host_str()
            .unwrap_or("")
            .trim_start_matches("www.")
            .to_lowercase()
    };
    host(left) == host(right)
}

pub(super) fn public_url(raw: &str) -> Result<Url, String> {
    if raw.chars().count() > 1000 || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("网页地址无效或过长。".into());
    }
    let mut url = Url::parse(raw).map_err(|_| "网页地址无效。")?;
    let host = url
        .host_str()
        .ok_or("网页地址缺少域名。")?
        .trim_end_matches('.')
        .to_lowercase();
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !host.contains('.')
        || host.parse::<IpAddr>().is_ok()
        || host.contains(':')
        || [
            ".localhost",
            ".local",
            ".internal",
            ".lan",
            ".home",
            ".test",
            ".invalid",
            ".onion",
        ]
        .iter()
        .any(|end| host.ends_with(end))
        || url.query_pairs().any(|(key, _)| {
            matches!(
                key.to_lowercase().replace('-', "_").as_str(),
                "key"
                    | "api_key"
                    | "apikey"
                    | "access_token"
                    | "token"
                    | "secret"
                    | "password"
                    | "authorization"
                    | "signature"
                    | "x_amz_signature"
                    | "x_amz_credential"
            )
        })
    {
        return Err("只允许不含凭据的公开网页地址和标准 HTTP/HTTPS 端口。".into());
    }
    url.set_host(Some(&host)).map_err(|_| "网页域名无效。")?;
    url.set_fragment(None);
    Ok(url)
}

/// DNS结果全部验证后固定到本次连接；拒绝IPv4映射/隧道和保留地址。
pub(super) fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || a == 0
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && (c == 0 || c == 2))
                || (a == 192 && b == 88 && c == 99)
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            ip.octets()[0] & 0xe0 == 0x20
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

pub(super) fn redirect(current: &Url, location: &str) -> Result<Url, String> {
    let joined = current.join(location).map_err(|_| "网页重定向地址无效。")?;
    let next = public_url(joined.as_str())?;
    if !same_site(current, &next) || (current.scheme() == "https" && next.scheme() != "https") {
        return Err("网页跳转到了其他网站或不安全连接，已停止读取。".into());
    }
    Ok(next)
}
