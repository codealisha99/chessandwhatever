"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const GameManager_1 = require("./GameManager");
console.log("Starting WebSocket server...");
const wss = new ws_1.WebSocketServer({
    port: 8080
});
const gameManager = new GameManager_1.GameManager();
console.log("Listening on ws://localhost:8080");
wss.on('connection', function connection(ws) {
    gameManager.addUser(ws);
    ws.on('disconnect', () => {
        gameManager.removeUser(ws);
    });
    console.log("Client connected!");
    ws.on('error', console.error);
    ws.on("message", (message) => {
        console.log("Received:", message.toString());
    });
    ws.send('something');
});
//# sourceMappingURL=index.js.map