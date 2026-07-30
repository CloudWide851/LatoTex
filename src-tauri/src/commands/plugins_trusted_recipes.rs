use crate::models::{PluginRuntimeAsset, PluginToolchainInstaller};

pub(crate) const MATLAB_MCP_PLUGIN_ID: &str = "latotex.science.matlab-mcp";
pub(crate) const MATLAB_MCP_CONTRIBUTION_ID: &str = "matlab-mcp.windows-x64";
pub(crate) const MATLAB_MCP_VERSION: &str = "0.11.2";
pub(crate) const MATLAB_MCP_URL: &str =
    "https://github.com/matlab/matlab-mcp-server/releases/download/v0.11.2/matlab-mcp-server-windows-x64.exe";
pub(crate) const MATLAB_MCP_SHA256: &str =
    "f51a440c00f2031b317d90027fa554c5813b20e553f69484278e3abdf4c5a206";
pub(crate) const MATLAB_MCP_ENTRY: &str = "matlab-mcp-server.exe";

pub(crate) const CRAN_R_PLUGIN_ID: &str = "latotex.science.r";
pub(crate) const CRAN_R_CONTRIBUTION_ID: &str = "r.managed.windows-x64";
pub(crate) const CRAN_R_VERSION: &str = "4.6.1";
pub(crate) const CRAN_R_URL: &str = "https://cran.r-project.org/bin/windows/base/R-4.6.1-win.exe";
pub(crate) const CRAN_R_SHA256: &str =
    "c5424c40cd70ef85765a55d2ff96bb602b5f30ed536938ff004f14db5db3c2df";
pub(crate) const CRAN_R_SIGNER_SUBJECT: &str =
    "CN=Martyn Plummer, O=Martyn Plummer, S=West Midlands, C=GB";
pub(crate) const CRAN_R_EXECUTABLE: &str = "bin/Rscript.exe";

pub(crate) fn matlab_mcp_asset() -> PluginRuntimeAsset {
    PluginRuntimeAsset {
        id: "matlab-mcp".to_string(),
        kind: "matlab-mcp".to_string(),
        platform: "windows-x64".to_string(),
        download_url: MATLAB_MCP_URL.to_string(),
        download_url_cn: None,
        sha256: MATLAB_MCP_SHA256.to_string(),
        archive_format: "exe".to_string(),
        entry_path: MATLAB_MCP_ENTRY.to_string(),
    }
}

pub(crate) fn cran_r_installer() -> PluginToolchainInstaller {
    PluginToolchainInstaller {
        id: "cran-r-4.6.1".to_string(),
        kind: "r".to_string(),
        platform: "windows-x64".to_string(),
        download_url: CRAN_R_URL.to_string(),
        download_url_cn: None,
        sha256: CRAN_R_SHA256.to_string(),
        archive_format: "exe".to_string(),
        executable: CRAN_R_EXECUTABLE.to_string(),
        version_arg: Some("--version".to_string()),
    }
}

pub(crate) fn is_matlab_mcp_asset(asset: &PluginRuntimeAsset) -> bool {
    let expected = matlab_mcp_asset();
    asset.id == expected.id
        && asset.kind == expected.kind
        && asset.platform == expected.platform
        && asset.download_url == expected.download_url
        && asset.download_url_cn.is_none()
        && asset.sha256.eq_ignore_ascii_case(&expected.sha256)
        && asset.archive_format == expected.archive_format
        && asset.entry_path == expected.entry_path
}

pub(crate) fn is_trusted_runtime_asset(
    plugin_id: &str,
    contribution_id: &str,
    asset: &PluginRuntimeAsset,
) -> bool {
    asset.archive_format != "exe"
        || (plugin_id == MATLAB_MCP_PLUGIN_ID
            && contribution_id == MATLAB_MCP_CONTRIBUTION_ID
            && is_matlab_mcp_asset(asset))
}

pub(crate) fn is_cran_r_installer(installer: &PluginToolchainInstaller) -> bool {
    let expected = cran_r_installer();
    installer.id == expected.id
        && installer.kind == expected.kind
        && installer.platform == expected.platform
        && installer.download_url == expected.download_url
        && installer.download_url_cn.is_none()
        && installer.sha256.eq_ignore_ascii_case(&expected.sha256)
        && installer.archive_format == expected.archive_format
        && installer.executable == expected.executable
        && installer.version_arg == expected.version_arg
}

pub(crate) fn is_trusted_toolchain_installer(
    plugin_id: &str,
    contribution_id: &str,
    installer: &PluginToolchainInstaller,
) -> bool {
    installer.archive_format != "exe"
        || (plugin_id == CRAN_R_PLUGIN_ID
            && contribution_id == CRAN_R_CONTRIBUTION_ID
            && is_cran_r_installer(installer))
}

#[cfg(test)]
mod tests {
    use super::{
        cran_r_installer, is_cran_r_installer, is_matlab_mcp_asset, is_trusted_runtime_asset,
        is_trusted_toolchain_installer, matlab_mcp_asset, CRAN_R_CONTRIBUTION_ID, CRAN_R_PLUGIN_ID,
        MATLAB_MCP_CONTRIBUTION_ID, MATLAB_MCP_PLUGIN_ID,
    };

    #[test]
    fn trusted_recipes_are_exact() {
        assert!(is_matlab_mcp_asset(&matlab_mcp_asset()));
        assert!(is_cran_r_installer(&cran_r_installer()));

        let mut changed_asset = matlab_mcp_asset();
        changed_asset.download_url.push_str("?mirror=1");
        assert!(!is_matlab_mcp_asset(&changed_asset));
        let mut changed_asset_hash = matlab_mcp_asset();
        changed_asset_hash.sha256.replace_range(..1, "0");
        assert!(!is_matlab_mcp_asset(&changed_asset_hash));
        let mut changed_asset_entry = matlab_mcp_asset();
        changed_asset_entry.entry_path = "other.exe".to_string();
        assert!(!is_matlab_mcp_asset(&changed_asset_entry));

        let mut changed_installer = cran_r_installer();
        changed_installer.executable = "payload.exe".to_string();
        assert!(!is_cran_r_installer(&changed_installer));
        let mut changed_installer_url = cran_r_installer();
        changed_installer_url.download_url.push_str("?mirror=1");
        assert!(!is_cran_r_installer(&changed_installer_url));
        let mut changed_installer_hash = cran_r_installer();
        changed_installer_hash.sha256.replace_range(..1, "0");
        assert!(!is_cran_r_installer(&changed_installer_hash));
        let mut changed_installer_version = cran_r_installer();
        changed_installer_version.version_arg = Some("-e".to_string());
        assert!(!is_cran_r_installer(&changed_installer_version));
    }

    #[test]
    fn executable_recipes_are_builtin_only_and_exact() {
        let asset = matlab_mcp_asset();
        assert!(is_trusted_runtime_asset(
            MATLAB_MCP_PLUGIN_ID,
            MATLAB_MCP_CONTRIBUTION_ID,
            &asset
        ));
        assert!(!is_trusted_runtime_asset(
            "publisher.custom",
            MATLAB_MCP_CONTRIBUTION_ID,
            &asset
        ));

        let installer = cran_r_installer();
        assert!(is_trusted_toolchain_installer(
            CRAN_R_PLUGIN_ID,
            CRAN_R_CONTRIBUTION_ID,
            &installer
        ));
        assert!(!is_trusted_toolchain_installer(
            "publisher.custom",
            CRAN_R_CONTRIBUTION_ID,
            &installer
        ));
    }
}
