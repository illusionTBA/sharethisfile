import { $ } from "bun";

await $`rm data.db`.nothrow();

// will throw if the data dir is empty
await $`rm data/*`.nothrow();
