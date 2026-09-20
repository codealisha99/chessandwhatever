"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Game = void 0;
const chess_js_1 = require("chess.js");
class Game {
    player1;
    player2;
    board;
    startTime;
    constructor(player1, player2) {
        this.player1 = player1;
        this.player2 = player2;
        this.board = new chess_js_1.Chess();
        this.startTime = new Date();
        this.player1.send(JSON.stringify({
            type: "init_game",
            payload: {
                color: "white",
                opponent: "black"
            }
        }));
        this.player2.send(JSON.stringify({
            type: "init_game",
            payload: {
                color: "white",
                opponent: "black"
            }
        }));
    }
    makeMove(player, move) {
        if (this.board.move.length % 2 === 0 && player !== this.player1) {
            return;
        }
        if (this.board.move.length % 2 === 1 && player !== this.player2) {
            return;
        }
        try {
            this.board.move(move);
        }
        catch (e) {
            return;
        }
        if (this.board.isGameOver()) {
            //this will notify player1 that the game is over
            this.player1.emit(JSON.stringify({
                type: "game_over",
                payload: {
                    winner: this.board.turn() === 'w' ? 'black' : 'white',
                }
            }));
            //this will notify player2 that the game is over 
            this.player2.emit(JSON.stringify({
                type: "game_over",
                payload: {
                    winner: this.board.turn() === 'w' ? 'black' : 'white',
                }
            }));
            if (this.board.moves.length % 2 === 0) {
                this.player2.emit(JSON.stringify({
                    type: "move",
                    payload: move
                }));
            }
            else {
                this.player1.emit(JSON.stringify({
                    type: "move",
                    payload: move
                }));
            }
        }
    }
}
exports.Game = Game;
//# sourceMappingURL=Game.js.map