import { WebSocket } from "ws";
import { Chess } from 'chess.js';

export class Game {
    public player1: WebSocket;
    public player2: WebSocket;
    public  board: Chess;
    public startTime: Date;
    


    constructor(player1: WebSocket, player2: WebSocket) {
        this.player1 = player1;
        this.player2 = player2;
        this.board = new Chess();
        this.startTime = new Date();
        this.player1.send(JSON.stringify({
            type: "init_game",
            payload: {
                color: "white",
                opponent: "black"
            }
        }))
        this.player2.send(JSON.stringify({
            type: "init_game",
            payload: {
                color: "white",
                opponent: "black"
            }
        }))

    }

    makeMove(player: WebSocket, move: {
        from: string;
        to: string;
    }) {
        if(this.board.move.length % 2 === 0 && player !== this.player1) { return; }
        if(this.board.move.length % 2 === 1 && player !== this.player2) { return; }



         try{
            this.board.move(move);
         }
         catch(e) {
            return;
         }


         if(this.board.isGameOver()) {
            //this will notify player1 that the game is over
           this.player1.emit(JSON.stringify({
               type: "game_over",
               payload: {
                winner: this.board.turn() === 'w' ? 'black' : 'white',
               }
             }))
            //this will notify player2 that the game is over 
              this.player2.emit(JSON.stringify({
                 type: "game_over",
                 payload: {
                      winner: this.board.turn() === 'w' ? 'black' : 'white',
                 }
         }))

         if (this.board.moves.length % 2 === 0) {
            this.player2.emit(JSON.stringify({
                type: "move",
                payload: move
            }))
         } else {
            this.player1.emit(JSON.stringify({
                type: "move",
                payload: move
            }))
         }
        
        
        
        
        
        }}}