import { WebSocketServer }from 'ws';
import { GameManager } from './GameManager';

console.log("Starting WebSocket server...");

const wss = new WebSocketServer({ 
    port: 8080 
});


const gameManager = new GameManager();

console.log("Listening on ws://localhost:8080");

wss.on('connection', function connection(ws) {
    gameManager.addUser(ws);
    ws.on('disconnect', () =>) {
        gameManager.removeUser(ws);
    }
 
    console.log("Client connected!");
    ws.on('error', console.error);


    ws.on('message' , function message(data) {
        console.log('received %s', data);
    });

    ws.send('something');

});