//! Windows user-scoped DPAPI. Disk data is UTF-8, with no entropy or description.
use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

pub const SCHEME: &str = "windows-dpapi-user-v1";

// Deliberately no Debug: accidental diagnostics must not expose stored secrets.
#[derive(Clone, Deserialize, Serialize)]
pub struct ProtectedKey {
    scheme: String,
    ciphertext: String,
}

impl ProtectedKey {
    pub fn protect(plaintext: &str) -> Result<Self> {
        let key = Self {
            scheme: SCHEME.into(),
            ciphertext: STANDARD.encode(transform(plaintext.as_bytes(), true)?),
        };
        if key.reveal()? != plaintext {
            bail!("LLM 配置密钥保护自检失败，原配置未更改");
        }
        Ok(key)
    }

    pub fn reveal(&self) -> Result<String> {
        if self.scheme != SCHEME {
            bail!("LLM 配置密钥保护格式不支持");
        }
        let bytes = STANDARD
            .decode(&self.ciphertext)
            .map_err(|_| anyhow::anyhow!("LLM 配置密文格式无效"))?;
        let value = String::from_utf8(transform(&bytes, false)?)
            .map_err(|_| anyhow::anyhow!("LLM 配置密钥内容无效"))?;
        if value.trim().is_empty() {
            bail!("LLM 配置密钥内容为空");
        }
        Ok(value)
    }
}

#[cfg(not(windows))]
fn transform(_input: &[u8], _protect: bool) -> Result<Vec<u8>> {
    bail!("LLM 配置密钥保护仅支持 Windows；不允许明文保存");
}

#[cfg(windows)]
fn transform(input: &[u8], protect: bool) -> Result<Vec<u8>> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let length = u32::try_from(input.len()).map_err(|_| anyhow::anyhow!("LLM 配置密钥长度无效"))?;
    if length == 0 {
        bail!("LLM 配置密钥内容为空");
    }
    let source = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    // SAFETY: input is live for the synchronous call; output is initialized and owned
    // by LocalAlloc. DPAPI doesn't mutate input. Null optional parameters disable UI,
    // entropy and descriptions. LOCAL_MACHINE is intentionally never used.
    unsafe {
        let success = if protect {
            CryptProtectData(
                &source,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &source,
                null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        let result = if success != 0 && !output.pbData.is_null() && output.cbData > 0 {
            Ok(std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec())
        } else {
            Err(anyhow::anyhow!(
                "LLM 配置密钥保护/解密失败；请使用原 Windows 用户或在设置中重新输入密钥"
            ))
        };
        if !output.pbData.is_null() {
            for i in 0..output.cbData as usize {
                std::ptr::write_volatile(output.pbData.add(i), 0);
            }
            LocalFree(output.pbData.cast());
        }
        result
    }
}
