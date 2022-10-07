import { spawnSync } from "child_process";
import { existsSync, mkdirSync, copySync, rmSync } from "fs-extra";
import { join } from "path";
import { readdirSync } from "fs";
const { getState } = require("@saltcorn/data/db/state");

/**
 * copy saltcorn-mobile-app as a template to buildDir
 * @param buildDir directory where the app will be build
 * @param templateDir directory of the template code that will be copied to 'buildDir'
 */
export function prepareBuildDir(buildDir: string, templateDir: string) {
  if (existsSync(buildDir)) rmSync(buildDir, { force: true, recursive: true });
  copySync(templateDir, buildDir);
  rmSync(`${buildDir}/node_modules`, { recursive: true, force: true });
  const result = spawnSync("npm", ["install", "--legacy-peer-deps"], {
    cwd: buildDir,
  });
  console.log(result.output.toString());
}

/**
 *
 * @param buildDir directory where the app will be build
 * @returns
 */
export function buildApkInContainer(buildDir: string) {
  const result = spawnSync(
    "docker",
    [
      "run",
      "-v",
      `${buildDir}:/saltcorn-mobile-app`,
      "saltcorn/cordova-builder",
    ],
    { cwd: "." }
  );
  console.log(result.output.toString());
  return result.status;
}

/**
 * build '.apk / .ipa' files with cordova (only android is tested)
 * @param flags
 * @returns
 */
export function buildApp(
  buildDir: string,
  platforms: string[],
  useDocker?: boolean,
  buildForEmulator?: boolean
) {
  if (!useDocker) {
    return callBuild(buildDir, platforms, buildForEmulator);
  } else {
    let code = buildApkInContainer(buildDir);
    if (code === 0 && platforms.indexOf("ios") > -1)
      code = callBuild(buildDir, ["ios"]);
    return code;
  }
}

/**
 *
 * @param buildDir directory where the app will be build
 * @param platforms
 */
export function addPlatforms(buildDir: string, platforms: string[]) {
  const result = spawnSync("npm", ["run", "add-platform", "--", ...platforms], {
    cwd: buildDir,
  });
  console.log(result.output.toString());
}

/**
 *
 * @param buildDir directory where the app will be build
 * @param platforms
 * @returns
 */
export function callBuild(
  buildDir: string,
  platforms: string[],
  buildForEmulator?: boolean
) {
  addPlatforms(buildDir, platforms);
  let buildParams = [...platforms];
  if (!buildForEmulator) {
    buildParams.push(
      "--device",
      `--developmentTeam="${getState().getConfig("apple_team_id")}"`
    );
  }
  const result = spawnSync("npm", ["run", "build-app", "--", ...buildParams], {
    cwd: buildDir,
  });
  console.log(result.output.toString());
  return result.status;
}

/**
 * find first file with specific ending
 * @param directory directory to search
 * @param ending wantet ending
 */
function fileWithEnding(directory: string, ending: string): string | null {
  if (!existsSync(directory)) return null;
  for (const file of readdirSync(directory)) {
    if (file.endsWith(ending)) return file;
  }
  return null;
}

function safeEnding(file: string, ending: string): string {
  if (!file.endsWith(ending)) return `${file}${ending}`;
  return file;
}

/**
 * copy .apk / .ipa files to 'copyDir' if they exist
 * @param buildDir directory where the app was build
 * @param copyDir directory where the resulting app file will be copied to
 * @param appFileName name of the copied app file
 */
export async function tryCopyAppFiles(
  buildDir: string,
  copyDir: string,
  appFileName?: string
) {
  if (!existsSync(copyDir)) {
    mkdirSync(copyDir);
  }
  // android .apk file
  const apkBuildDir = join(
    buildDir,
    "platforms",
    "android",
    "app",
    "build",
    "outputs",
    "apk",
    "debug"
  );
  const apkFile = fileWithEnding(apkBuildDir, ".apk");
  if (apkFile) {
    copySync(
      join(apkBuildDir, apkFile),
      join(
        copyDir,
        appFileName ? safeEnding(appFileName, ".apk") : "app-debug.apk"
      )
    );
  }
  // iOS .ipa file
  const ipaBuildDir = join(buildDir, "platforms", "ios", "build", "device");
  const ipaFile = fileWithEnding(ipaBuildDir, ".ipa");
  if (ipaFile) {
    copySync(
      join(ipaBuildDir, ipaFile),
      join(
        copyDir,
        appFileName ? safeEnding(appFileName, ".ipa") : "app-debug.ipa"
      )
    );
  }
}