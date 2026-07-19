import { WebSocket } from "ws";
import { Chess } from 'chess.js';

export class Game {
    private player1: WebSocket;
    private player2: WebSocket;
    private board: Chess;
    private startTime: Date;


    constructor(player1: WebSocket, player2: WebSocket) {
        this.player1 = player1;
        this.player2 = player2;
        this.board = new Chess();
        this.startTime = new Date();

    }

    makeMove(player: WebSocket, move: string) {
      
    }
}