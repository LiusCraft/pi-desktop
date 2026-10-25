// electron-builder afterSign hook: notarize + staple the .app before the dmg
// is built, and make sure an unsigned local build is at least ad-hoc signed
// (Apple Silicon will not start an arm64 bundle that has no signature at all).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// codesign prints its report on stderr, whether it succeeds or fails.
function signatureReport(appPath) {
  try {
    return String(execFileSync('codesign', ['-dv', '--verbose=2', appPath], { stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (err) {
    return String(err.stderr || '');
  }
}

function notarizeOptions() {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  const { APPLE_KEYCHAIN_PROFILE } = process.env;
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    return { appleId: APPLE_ID, appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD, teamId: APPLE_TEAM_ID };
  }
  if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    return { appleApiKey: APPLE_API_KEY, appleApiKeyId: APPLE_API_KEY_ID, appleApiIssuer: APPLE_API_ISSUER };
  }
  if (APPLE_KEYCHAIN_PROFILE) return { tool: 'notarytool', keychainProfile: APPLE_KEYCHAIN_PROFILE };
  return null;
}

exports.default = async function afterSign(params) {
  if (params.electronPlatformName !== 'darwin') return;
  const appPath = path.join(params.appOutDir, `${params.packager.appInfo.productFilename}.app`);

  if (!/Developer ID Application/.test(signatureReport(appPath))) {
    // No certificate: electron-builder leaves the bundle unsigned, and Apple
    // Silicon refuses to run arm64 binaries with no signature at all. Ad-hoc
    // signing keeps `make app` / `make dmg` usable (Gatekeeper still warns on
    // a downloaded dmg, which is expected without a Developer ID).
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    console.log('[sign] ad-hoc signed (no Developer ID certificate found)');
    return;
  }
  const options = notarizeOptions();
  if (!options) {
    console.log('[notarize] skipped: set APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID');
    console.log('[notarize]           or APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER');
    return;
  }

  // Resolved through devDependencies; electron-builder only ships it transitively.
  const { notarize } = require('@electron/notarize');
  console.log('[notarize] submitting', appPath);
  await notarize({ appPath, ...options });
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
  console.log('[notarize] done, ticket stapled');
};
