import { WebSocketServer }from 'ws';
import { GameManager } from './GameManager';

console.log("Starting WebSocket server...");

const wss = new WebSocketServer({ 
    port: 8080 
});

const gameManager = new GameManager();

console.log("Listening on ws://localhost:8080");
    //persistent connection
     wss.on('connection', function connection(ws) {
        
         //add user to the game manager
        gameManager.addUser(ws);

        //1)
        ws.on('disconnect', () => {
        gameManager.removeUser(ws);
            });
 
        console.log("Client connected!");

        //2)
        ws.on('error', console.error);

        //3)
        ws.on("message", (message) => {
                console.log("Received:", message.toString());
            });
        //4)
        ws.send('something');

});