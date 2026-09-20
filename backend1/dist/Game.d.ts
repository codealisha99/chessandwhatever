import { WebSocket } from "ws";
import { Chess } from 'chess.js';
export declare class Game {
    player1: WebSocket;
    player2: WebSocket;
    board: Chess;
    startTime: Date;
    constructor(player1: WebSocket, player2: WebSocket);
    makeMove(player: WebSocket, move: {
        from: string;
        to: string;
    }): void;
}
//# sourceMappingURL=Game.d.ts.map