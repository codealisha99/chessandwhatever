import { WebSocket } from "ws";
import { Chess } from 'chess.js';
import { INIT_GAME, MOVE } from "./message";

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
            type: INIT_GAME,
            payload: {
                color: "white",
                
            }
        }))
        this.player2.send(JSON.stringify({
            type: INIT_GAME,
            payload: {
                color: "black",
               
            }
        }))

    }
    //method-1
    makeMove(player: WebSocket, move: {from: string;to: string;}) 
    {
        // 1validating the move 
        if(this.board.moves().length % 2 === 0 && player !== this.player1) { return; }
        if(this.board.moves().length % 2 === 1 && player !== this.player2) { return; }


         //2) making the move on the board
         try{
            this.board.move(move);
         }
         catch(e) {
            console.log("Invalid move:", e);
            return;
         }

           //3) game over check
         if(this.board.isGameOver()) {
            //this will notify player1 that the game is over
           this.player1.send(JSON.stringify({
               type: "game_over",
               payload: {
                winner: this.board.turn() === 'w' ? 'black' : 'white',
               }
             }))
            //this will notify player2 that the game is over 
              this.player2.send(JSON.stringify({
                 type: "game_over",
                 payload: {
                      winner: this.board.turn() === 'w' ? 'black' : 'white',
                 }
         }))
        
         //4) sending the move to the other player
         if (this.board.moves().length % 2 === 0) {
            this.player2.send(JSON.stringify({
                type: MOVE,
                payload: move
            }))
         } else {
            this.player1.(JSON.stringify({
                type: MOVE,
                payload: move
            }))
         }
        
        
        
        
        
        }}}