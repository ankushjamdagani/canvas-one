import { version } from "../../package.json";

/** Version label shown in the public header. Single source of truth: package.json. */
export const APP_VERSION = version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
