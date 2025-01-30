import { Elysia, t } from "elysia";
import { cron, Patterns  } from '@elysiajs/cron'
import { Database } from "bun:sqlite";
import { log } from "./utils";
import { nanoid } from "nanoid";
import fs from "node:fs/promises"
type DBFile = {
  id: string;
  name: string;
  hash: string;
  size: number;
  loc: string;
  views: number;
  created_at: string;
};

const db = new Database("data.db");

// Create tables with views column
db.exec(`
    CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        views INTEGER DEFAULT 0,
        ttl INTEGER DEFAULT 0,
        loc TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

const dataDir = "./data";
const pass = Bun.env.PASSWORD;

const hashedPass = pass ? hashText(pass) : "";
let passwordEnabled = !!pass;

const insertFile = db.prepare(
  `INSERT INTO files (id, name, hash, size, loc) VALUES (?, ?, ?, ?, ?) RETURNING *`
);

const getFile = db.prepare(`SELECT * FROM files WHERE id = ?`);
const getByHash = db.prepare(`SELECT * FROM files WHERE hash = ?`);
const deleteFile = db.prepare(`DELETE FROM files WHERE id = ?`);
const getFiles = db.prepare(`SELECT * FROM files ORDER BY created_at DESC`);
const incrementViews = db.prepare(
  `UPDATE files SET views = views + 1 WHERE id = ?`
);

const app = new Elysia({
  serve: {
    maxRequestBodySize: 1024 * 1024 * 1024,
  },
})
.use(
  cron({
      name: 'heartbeat',
      pattern: Patterns.everyMinutes(1),
      async run() {
          log.info("Checking storage sync...")
          const files = getFiles.all() as DBFile[];
          let count = 0;
          for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const exists = await Bun.file(file.loc).exists();
              if (!exists) {
                await deleteFile.run(file.id)
                log.info(`${file.id} Deleted from db (out of sync)...`)
                count++;
                continue;
              }

          }
          log.info(`Removed ${count} out of sync files.`)
      }
  })
)
  .get("/", ({ cookie: { pass } }) => {
    if (!passwordEnabled) return Bun.file("./public/index.html");
    if (!pass?.value || pass.value !== hashedPass)
      return Bun.file("./public/p.html");
    return Bun.file("./public/index.html");
  })
  .post(
    "/p",
    async ({ body: { password }, cookie: { pass } }) => {
      if (!password) return jsonResponse({ success: false });
      if (hashText(password) === hashedPass) {
        pass.value = hashText(password);
        return jsonResponse({ success: true });
      }
      return jsonResponse({ success: false });
    },
    {
      body: t.Object({
        password: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/file/:id",
    async ({ params }) => {
      const { id } = params;
      if (!id) return new Response("No id provided", { status: 400 });

      const file = getFile.get(id) as DBFile;
      if (!file)
        return jsonResponse({ success: false, message: "File not found" }, 404);

      // Increment view count
      incrementViews.run(id);

      const f = Bun.file(file.loc);
      if (!(await f.exists()))
        return jsonResponse({ success: false, message: "File not found" }, 404);

      return Bun.file(file.loc);
    },
    {
      params: t.Object({
        id: t.Optional(t.String()),
      }),
    }
  )
  .get("/recent", async () => {
    const files = getFiles.all() as DBFile[];
    return jsonResponse(files);
  })
  .post(
    "/upload",
    async ({ body: { f }, cookie: { pass } }) => {
      if (!f) return new Response("No file provided", { status: 400 });
      if (passwordEnabled && pass?.value !== hashedPass) {
        return {
          success: false,
          message: "Unauthorized",
        };
      }
      const hash = await hashFile(f);
      const exists = getByHash.get(hash);
      if (exists) {
        log.info(`File ${f.name} with hash ${hash} already exists`);
        return {
          success: false,
          message: "File already exists with the same hash",
        };
      }

      const written = await Bun.write(`${dataDir}/${hash}_${f.name}`, f);
      const d = insertFile.all(
        nanoid(),
        f.name,
        hash,
        f.size,
        `${dataDir}/${hash}_${f.name}`
      ) as DBFile[];

      if (d.length === 0) {
        return {
          success: false,
          message: "Error inserting file into database",
        };
      }

      log.info(
        `Uploaded file ${f.name} (${d[0].id}) with hash ${hash} size: ${f.size}`
      );
      return { success: true, id: d[0].id };
    },
    {
      body: t.Object({
        f: t.Optional(t.File()),
      }),
    }
  )
  .listen(parseInt(Bun.env.PORT || "8080"));

log.info(`Server started ${app.server?.url}`);

async function hashFile(file: File) {
  const buf = await file.arrayBuffer();
  return new Bun.CryptoHasher("sha256").update(buf).digest("hex");
}

function hashText(text: string) {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
