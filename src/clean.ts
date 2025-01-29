import { $ } from "bun";

await $`rm data.db`;

await $`rm data/*`;
