import { Game } from "./Game";
import { WebSocket } from "ws";
import { INIT_GAME, MOVE } from "./message";


//GAME TABLE 
export class GameManager {
    private games: Game[];
    private pendingUser : WebSocket | null;
    private users: WebSocket[];
    private activeUsers: WebSocket[];

    constructor() {
        this.games = [];
        this.pendingUser = null;
        this.users = [];
        this.activeUsers = [];
    }
    //method-1
    addUser(socket: WebSocket) {
         this.users.push(socket);
         this.addHandler(socket);
    }
    //method-2
    removeUser(socket: WebSocket) {
        //stop the game here because the user has disconnected
       this.users = this.users.filter(user => user !== socket);

    }

    //method-3
    private addHandler (socket: WebSocket) {
    socket.on('message', (data) => {
        const messages = JSON.parse(data.toString());




         if(messages.type === INIT_GAME) {

            if (this.pendingUser) {
                //start a new game
                const game = new Game(this.pendingUser, socket);
                this.games.push(game); //Games = [game1, game2, game3]
               this.pendingUser = null;
             } 
             else {
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

