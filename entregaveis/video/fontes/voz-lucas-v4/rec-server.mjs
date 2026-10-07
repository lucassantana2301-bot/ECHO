// Local server for the narration recording page. Takes are saved to vo-lucas/<id>.wav.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAKES = path.join(HERE, "vo-lucas");
fs.mkdirSync(TAKES, { recursive: true });
const ids = JSON.parse(fs.readFileSync(path.join(HERE, "script.json"), "utf8")).map((l) => l.id);

http
  .createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/" || url === "/record.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return fs.createReadStream(path.join(HERE, "record.html")).pipe(res);
    }
    if (url === "/script.json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return fs.createReadStream(path.join(HERE, "script.json")).pipe(res);
    }
    if (url === "/saved") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(ids.filter((id) => fs.existsSync(path.join(TAKES, `${id}.wav`)))));
    }
    const m = url.match(/^\/take\/(L\d\d)\.wav$/);
    if (m && ids.includes(m[1])) {
      const file = path.join(TAKES, `${m[1]}.wav`);
      if (req.method === "POST") {
        const out = fs.createWriteStream(file);
        req.pipe(out);
        out.on("finish", () => {
          console.log(`saved ${m[1]} (${fs.statSync(file).size} bytes)`);
          res.end("ok");
        });
        return;
      }
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "audio/wav");
        return fs.createReadStream(file).pipe(res);
      }
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(5195, "127.0.0.1", () => console.log("recording page: http://localhost:5195/"));
