// Loads .env.local, but ONLY for the opt-in database tests.
//
// Gated rather than unconditional on purpose: the default suite is pure functions with no
// database and no network, and it must stay that way. Loading real credentials into every
// run would let a test quietly start depending on a live service, and the suite would then
// pass or fail based on what is in one developer's .env.local.
import { config } from "dotenv";

if (process.env.RUN_BMS_DB_TEST === "true") {
  config({ path: ".env.local" });
}
