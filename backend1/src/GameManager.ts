import { Game } from "./Game";
import { WebSocket } from "ws";
import { INIT_GAME, MOVE } from "./message";



export class GameManager {
    private games: Game[];
    private pendingUser : WebSocket | null;
    private users: WebSocket[];

    constructor() {
        this.games = [];
        this.pendingUser = null;
        this.users = [];
    }

    addUser(socket: WebSocket) {
         this.users.push(socket);
         this.addHandler(socket);
    }

    removeUser(socket: WebSocket) {
       this.users = this.users.filter(user => user !== socket);
    }

private addHandler (socket: WebSocket) {
    socket.on('message', (data) => {
        const messages = JSON.parse(data.toString());




         if(messages.type === INIT_GAME) {

            if (this.pendingUser) {
                const game = new Game(this.pendingUser, socket);
                this.games.push(game);
               this.pendingUser = null;
             } else {
               this.pendingUser = socket;
            }
         }



         if (messages.type === MOVE) {
              const game = this.games.find(game => game.player1 === socket || game.player2 === socket);
              if (game) {
                game.makeMove(socket, messages.payload);
              }
         }
        
        });
        
        }
}

