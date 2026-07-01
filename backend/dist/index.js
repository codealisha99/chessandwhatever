"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
console.log("Starting WebSocket server...");
const wss = new ws_1.WebSocketServer({
    port: 8080
});
console.log("Listening on ws://localhost:8080");
wss.on('connection', function connection(ws) {
    console.log("Client connected!");
    ws.on('error', console.error);
    ws.on('message', function message(data) {
        console.log('received %s', data);
    });
    ws.send('something');
});
//# sourceMappingURL=index.js.map