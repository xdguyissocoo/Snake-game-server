const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

const WIDTH = 30;
const HEIGHT = 20;

let waitingPlayer = null;
const games = new Map();


// ==============================
// SERVER STATUS PAGE
// ==============================

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Snake Online Server</title>

<style>
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #101010;
  color: white;
  font-family: Arial;
  text-align: center;
}

.box {
  background: #202020;
  padding: 30px;
  border-radius: 20px;
  box-shadow: 0 0 30px #000;
}

h1 {
  color: #55ff66;
}

.online {
  color: #55ff66;
  font-size: 20px;
}
</style>
</head>

<body>

<div class="box">

<h1>🐍 Snake Online</h1>

<p class="online">● SERVER ONLINE</p>

<p>
Players connected:
<b id="players">0</b>
</p>

</div>

<script src="/socket.io/socket.io.js"></script>

<script>

const socket = io();

socket.on("playerCount", count => {
  document.getElementById("players").textContent = count;
});

</script>

</body>
</html>
  `);
});


// ==============================
// CREATE FOOD
// ==============================

function createFood(game) {

  let food;

  do {

    food = {
      x: Math.floor(Math.random() * WIDTH),
      y: Math.floor(Math.random() * HEIGHT)
    };

  } while (
    game.players.some(player =>
      game.snakes[player].some(part =>
        part.x === food.x &&
        part.y === food.y
      )
    )
  );

  return food;
}


// ==============================
// CREATE GAME
// ==============================

function createGame(player1, player2) {

  const game = {

    players: [
      player1,
      player2
    ],

    snakes: {

      [player1]: [
        { x: 5, y: 10 },
        { x: 4, y: 10 },
        { x: 3, y: 10 }
      ],

      [player2]: [
        { x: 24, y: 10 },
        { x: 25, y: 10 },
        { x: 26, y: 10 }
      ]

    },

    directions: {

      [player1]: {
        x: 1,
        y: 0
      },

      [player2]: {
        x: -1,
        y: 0
      }

    },

    scores: {

      [player1]: 0,
      [player2]: 0

    },

    alive: {

      [player1]: true,
      [player2]: true

    },

    food: {
      x: 15,
      y: 10
    }

  };

  game.food = createFood(game);

  games.set(player1, game);
  games.set(player2, game);

  io.to(player1).emit("matchFound", {
    player: 1
  });

  io.to(player2).emit("matchFound", {
    player: 2
  });

  sendState(game);
}


// ==============================
// SEND GAME STATE
// ==============================

function sendState(game) {

  const state = {

    snakes: game.snakes,
    directions: game.directions,
    scores: game.scores,
    alive: game.alive,
    food: game.food,
    width: WIDTH,
    height: HEIGHT

  };

  for (const player of game.players) {

    io.to(player).emit(
      "gameState",
      state
    );

  }
}


// ==============================
// END GAME
// ==============================

function endGame(game, winner) {

  for (const player of game.players) {

    io.to(player).emit(
      "gameOver",
      {
        winner: winner
      }
    );

  }

  games.delete(game.players[0]);
  games.delete(game.players[1]);
}


// ==============================
// UPDATE GAME
// ==============================

function updateGame(game) {

  const players = game.players;

  for (const player of players) {

    if (!game.alive[player]) {
      continue;
    }

    const snake = game.snakes[player];

    const direction =
      game.directions[player];

    const head = snake[0];

    const newHead = {

      x: head.x + direction.x,
      y: head.y + direction.y

    };


    // WALL COLLISION

    if (
      newHead.x < 0 ||
      newHead.x >= WIDTH ||
      newHead.y < 0 ||
      newHead.y >= HEIGHT
    ) {

      game.alive[player] = false;
      continue;

    }


    // OWN BODY COLLISION

    const body = snake.slice(0, -1);

    if (
      body.some(part =>
        part.x === newHead.x &&
        part.y === newHead.y
      )
    ) {

      game.alive[player] = false;
      continue;

    }


    // ENEMY COLLISION

    const enemy =
      players.find(
        p => p !== player
      );

    if (
      game.snakes[enemy].some(part =>
        part.x === newHead.x &&
        part.y === newHead.y
      )
    ) {

      game.alive[player] = false;
      continue;

    }


    // MOVE

    snake.unshift(newHead);


    // FOOD

    if (
      newHead.x === game.food.x &&
      newHead.y === game.food.y
    ) {

      game.scores[player]++;

      game.food =
        createFood(game);

    } else {

      snake.pop();

    }

  }


  const alivePlayers =
    players.filter(
      p => game.alive[p]
    );


  if (alivePlayers.length === 1) {

    endGame(
      game,
      alivePlayers[0]
    );

    return;

  }


  if (alivePlayers.length === 0) {

    endGame(
      game,
      null
    );

    return;

  }


  sendState(game);

}


// ==============================
// CONNECTION
// ==============================

io.on("connection", socket => {

  console.log(
    "Player connected:",
    socket.id
  );


  io.emit(
    "playerCount",
    io.engine.clientsCount
  );


  // MATCHMAKING

  if (
    waitingPlayer &&
    waitingPlayer.connected
  ) {

    const first =
      waitingPlayer;

    waitingPlayer = null;

    createGame(
      first.id,
      socket.id
    );

  } else {

    waitingPlayer = socket;

    socket.emit("waiting");

  }


  // ============================
  // PLAYER MOVEMENT
  // ============================

  socket.on(
    "move",
    direction => {

      const game =
        games.get(socket.id);

      if (!game) {
        return;
      }

      if (!direction) {
        return;
      }

      const current =
        game.directions[socket.id];

      if (!current) {
        return;
      }


      // ONLY 4 DIRECTIONS

      if (
        Math.abs(direction.x) +
        Math.abs(direction.y) !== 1
      ) {

        return;

      }


      // PREVENT INSTANT REVERSE

      if (
        direction.x === -current.x &&
        direction.y === -current.y
      ) {

        return;

      }


      game.directions[socket.id] = {

        x: direction.x,
        y: direction.y

      };

    }
  );


  // ============================
  // DISCONNECT
  // ============================

  socket.on(
    "disconnect",
    () => {

      console.log(
        "Player disconnected:",
        socket.id
      );


      if (
        waitingPlayer === socket
      ) {

        waitingPlayer = null;

      }


      const game =
        games.get(socket.id);


      if (game) {

        const opponent =
          game.players.find(
            p => p !== socket.id
          );


        if (opponent) {

          io.to(opponent).emit(
            "opponentDisconnected"
          );

        }


        games.delete(
          game.players[0]
        );

        games.delete(
          game.players[1]
        );

      }


      io.emit(
        "playerCount",
        io.engine.clientsCount
      );

    }
  );

});


// ==============================
// GAME LOOP
// ==============================

setInterval(
  () => {

    const updated =
      new Set();

    for (
      const game of games.values()
    ) {

      if (
        updated.has(game)
      ) {

        continue;

      }

      updated.add(game);

      updateGame(game);

    }

  },
  150
);


// ==============================
// START SERVER
// ==============================

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "Snake server running on port " +
      PORT
    );

  }
);
