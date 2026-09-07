import { defineConfig, type Plugin } from "vite";
import { writeFile, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// 引擎编辑器的写回通道（地图数据是 JSON，一张图一个文件）：
//   GET/POST /game     → src/data/gameMap.json     游戏采用哪张图 { gameMapId }
//   GET/POST/DELETE /map/<ID> → src/data/maps/<ID>.json   一张图一个文件（ID = 2~4 位大写字母数字）
//   GET/POST /materials → src/data/materialData.ts  物件材质
//   GET/POST /props     → src/data/propData.ts      自定义物件
// 仅存在于本地 dev server；文件变化后 Vite 会自动刷新打开了游戏页的浏览器。
//
// 防覆盖护栏（x-pw-base 哈希校验）：POST/DELETE 必须带 `x-pw-base` = 目标文件磁盘内容的当前哈希
// （GET 可取到；文件不存在时哈希为空串——新建文件因此放行）。哈希对不上 = 文件在编辑器装载后
// 被外部改过（手改 / 另一个会话 / **旧版编辑器页面**）→ 409 拒写。不带头的请求（老页面）
// 一律 409——宁可保存失败，也不能让旧内存文档把新文件盖回去。
const SAVE_ROUTES: Record<string, string> = {
  "/game": "src/data/gameMap.json",
  "/materials": "src/data/materialData.ts",
  "/props": "src/data/propData.ts",
};
const MAP_ID_RE = /^\/map\/([A-Z0-9]{2,4})$/; // id 白名单同时防路径穿越

const diskHash = (file: string): string =>
  createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 12);

function saveEngineFiles(): Plugin {
  return {
    name: "plantwell-save-engine-files",
    configureServer(server) {
      server.middlewares.use("/__save", (req, res) => {
        const route = (req.url ?? "").split("?")[0];
        let rel: string | null = SAVE_ROUTES[route] ?? null;
        let mapId: string | null = null;
        const mapMatch = MAP_ID_RE.exec(route);
        if (mapMatch) {
          mapId = mapMatch[1];
          rel = `src/data/maps/${mapId}.json`;
        }
        if (!rel) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const file = path.resolve(server.config.root, rel);
        const json = (code: number, payload: unknown): void => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(payload));
        };
        const currentHash = (): string => {
          try {
            return diskHash(file);
          } catch {
            return "";
          }
        };
        if (req.method === "GET") {
          try {
            json(200, { ok: true, hash: diskHash(file) });
          } catch {
            json(200, { ok: true, hash: "" }); // 文件还不存在（新地图）：空哈希=可创建
          }
          return;
        }
        // 删除地图文件（仅 /map/<ID>）：同样要过哈希护栏；文件已不在=幂等成功
        if (req.method === "DELETE") {
          if (!mapId) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const current = currentHash();
          const base = (req.headers["x-pw-base"] as string | undefined) ?? "";
          if (current && base !== current) {
            json(409, { ok: false, stale: true, error: "文件在编辑器装载后被外部修改过，请刷新编辑器后再删。" });
            return;
          }
          unlink(file)
            .then(() => json(200, { ok: true }))
            .catch(() => json(200, { ok: true, gone: true }));
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        // 收 Buffer 再整体解码：按 chunk 直接拼字符串会在多字节字符（中文注释）中间截断
        const chunks: Buffer[] = [];
        let bytes = 0;
        req.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          bytes += chunk.length;
          if (bytes > 8_000_000) req.destroy(); // 防呆：单张地图 JSON 远到不了这个量级
        });
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          // 哈希对不上（或没带）就拒写：磁盘内容已经不属于这个编辑器页面了。
          // 空哈希=目标文件尚不存在（新建地图/首次保存），放行。
          const current = currentHash();
          const base = (req.headers["x-pw-base"] as string | undefined) ?? "";
          if (current && base !== current) {
            json(409, {
              ok: false,
              stale: true,
              error:
                "数据文件在编辑器装载后被外部修改过（或页面是旧版代码）。请刷新编辑器页面载入最新内容后再保存。",
            });
            return;
          }
          writeFile(file, body, "utf8")
            .then(() => {
              json(200, { ok: true, bytes: body.length, hash: diskHash(file) });
            })
            .catch((err: unknown) => {
              json(500, { ok: false, error: String(err) });
            });
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [saveEngineFiles()],
  // dev server 文件监视：排除探针/CDP 的浏览器 profile（Chromium 会高频改写 Cookies 等，
  // Windows 上 fs.watch 盯到会 EBUSY 直接崩掉整个 dev server）
  server: {
    watch: {
      ignored: ["**/.cdpprofile/**"],
    },
  },
  // 编辑器也打进产物（线上 = 可看/可导出的查看器；写回通道是 dev 中间件，线上不存在，
  // 保存会走剪贴板/下载兜底并明确提示）。
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
        editor: path.resolve(__dirname, "editor.html"),
      },
    },
  },
});
