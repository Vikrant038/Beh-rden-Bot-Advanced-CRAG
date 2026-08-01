import http from "http";

const req = http.request(
  {
    hostname: "localhost",
    port: 3000,
    path: "/api/chat/stream",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  },
  (res) => {
    console.log("STATUS:", res.statusCode);
    res.on("data", (chunk) => console.log("DATA:", chunk.toString()));
  },
);
req.write(
  JSON.stringify({ conversationId: "cms9qkw3000bqy3oba78ve5at", query: "hi", mode: "agentic" }),
);
req.end();
