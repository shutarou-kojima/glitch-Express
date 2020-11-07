/********************
 *  modules
 ********************/
var express = require("express"),
  ejs = require("ejs"),
  fs = require("fs"),
  jc = require("json-cycle"),
  bodyParser = require("body-parser"),
  logger = require("morgan"),
  session = require("express-session"),
  csrf = require("csurf"),
  cookieParser = require("cookie-parser"),
  // サーバーの定義
  app = express(),
  http = require("http").Server(app),
  io = require("socket.io")(http),
  passport = require("passport"),
  LocalStrategy = require("passport-local").Strategy;

// ローカル開発環境用の処理
if (process.env.PORT == null) {
  // envファイルを明示的に読み込む必要がある。
  require("dotenv").config();
}

// ejsの設定
app.set("views", __dirname + "/views");
app.set("view engine", "ejs");

// 静的ファイルのディレクトリ指定
app.use(express.static("public"));

// JSONファイルの読み込み
var accounts = JSON.parse(fs.readFileSync("./data/accounts.json", "utf8"));
var rooms = JSON.parse(fs.readFileSync("./data/rooms.json", "utf8"));

/********************
 *  middleware
 ********************/
// リクエスト・ボディをオブジェクトに変換する。
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/*** csrf対策 ***/
// クッキーをオブジェクトに変換する。
app.use(cookieParser());
// セッションを有効にする。
app.use(
  session({
    secret: process.env.SECRET,
    resave: true,
    saveUninitialized: true
  })
);
app.use(csrf());
app.use((req, res, next) => {
  // res.localsにcsrfトークンを書き込む。
  res.locals.csrftoken = req.csrfToken();
  next();
});

/*** passport ***/
// 初期化
app.use(passport.initialize());
// セッションの使用
app.use(passport.session());

// ログ機能
app.use(logger("dev"));

// 自作ミドルウェア
app.use((err, req, res, next) => {
  res.send(err.message);
});

// passport シリアライズ
passport.serializeUser((user, done) => {
  done(null, user);
});

// passport デシリアライズ
passport.deserializeUser((user, done) => {
  done(null, user);
});

// passport LocalStrategy
passport.use(
  new LocalStrategy((username, password, done) => {
    // ここで username と password を確認して結果を返す
    // 登録しているユーザー名にヒットするかを検索
    let index = accounts.findIndex(account => {
      return account.user.name == username;
    });

    if (index === -1) {
      // ヒットしない場合、パスワードが半角英数字4文字以上かをチェック
      if (/^([a-zA-Z0-9]{4,})$/.test(password)) {
        // チェックをクリアしたら、新しいユーザーとして登録
        accounts.push({
          password: password,
          user: {
            id: accounts.length,
            name: username,
            room: {
              id: 0,
              isPlayer: false,
              isMaster: false
            }
          }
        });
        fs.writeFile(
          "./data/accounts.json",
          JSON.stringify(accounts),
          err => {}
        );
        index = accounts.length - 1;
      } else {
        // クリアしなかったら、パスワードが短い、文字種が違う等のエラーを返す
        done(null, false, {
          message: "パスワードが短い／半角英数字ではない。"
        });
      }
      // ヒットした場合、登録済みパスワードと一致するかチェック
    } else if (accounts[index].password !== password) {
      // 登録はあるが、パスワードが間違っているのエラーを返す
      return done(null, false, { message: "パスワードが正しくありません。" });
    }
    // ユーザー名とパスワードがあっていた場合、idとnameを入れてdone
    return done(null, { id: index, name: username });
  })
);

/********************
 *  routing
 ********************/

// トップ画面
app.get(
  "/",
  // ログイン済みかチェック。 Out
  loggedInOutside,
  // game/index.ejsをレンダー
  (req, res) => {
    res.render("game/index");
  }
);

// ログイン画面
app.get(
  "/login",
  // ログイン済みかチェック。 Out
  loggedInOutside,
  // game/login.ejsをレンダー
  (req, res) => {
    res.render("game/login");
  }
);

// ログイン画面からのポスト
app.post(
  "/login",
  // passport.authenticate
  // パスポートのミドルウェアを呼び出した？
  passport.authenticate(
    "local",
    // 失敗すれば /login へリダイレクト
    { failureRedirect: "/login" }
  ),
  // 成功すれば、 /lobby へリダイレクト
  (req, res) => {
    res.redirect("/lobby");
  }
);

// ルーム作成画面へ移動
app.get(
  "/make",
  // ログイン済みかチェック。 In
  loggedInInside,
  // game/make.ejsをレンダー
  (req, res) => {
    var render_data = {
      user: accounts[req.user.id].user,
      rooms: rooms
    };
    res.render("game/make", render_data);
  }
);

// ルーム作成
app.post(
  "/make",
  // ログイン済みかチェック。 In
  loggedInInside,
  (req, res, next) => {
    // 新規ルームの情報を作成。
    var roomId = rooms.length - 0;

    // roomsに、テンプレ＋製作者情報を入れたroomオブジェクトをpush
    rooms.push({
      id: roomId,
      name: req.body.roomName,
      membersId: [req.user.id],
      maxMembers: req.body.maxMembers,
      status: {
        turn: 0,
        turnCount: 0,
        oxTable: [-1, -1, -1, -1, -1, -1, -1, -1, -1],
        playersId: [-1, -1],
        playersName: ["未定", "未定"],
        progress: "playing"
      },
      chatLog: [
        {
          name: req.user.name,
          msg: "が、ルームを作成しました。",
          timeStamp: timeStamp()
        }
      ]
    });

    // roomsデータが新しくなったので ./data/rooms.json を更新。
    fs.writeFile("./data/rooms.json", JSON.stringify(rooms), err => {});

    // 製作者がルームに入ったので、accounts.jsonも更新する。
    accounts[req.user.id].user.room.id = roomId;
    fs.writeFile("./data/accounts.json", JSON.stringify(accounts), err => {});

    // ルーム作成情報をロビー閲覧者にemitする。
    io.emit("receive_lobby", {
      roomId: roomId,
      room: rooms[roomId],
      flag: "create"
    });

    // /room/:id へリダイレクト
    res.redirect("/room/" + roomId);
  }
);

// ルーム画面
app.get(
  "/room/:id([0-9]+)",
  // ログイン済みかチェック。In
  loggedInInside,
  checkout,
  (req, res) => {
    // game/room.ejsをレンダー
    //   {user: , rooms: }
    var render_data = {
      user: accounts[req.user.id].user,
      rooms: rooms
    };
    res.render("game/room", render_data);
  }
);

// ルーム入室 from Lobby
app.get(
  "/room/:id([0-9]+)/enter",
  // ログイン済みかチェック。 In
  loggedInInside,
  (req, res, next) => {
    var roomId = req.params.id - 0;

    // ユーザーIDの追加
    rooms[roomId].membersId.push(req.user.id);

    // users.jsonの更新
    accounts[req.user.id].user.room.id = roomId;
    fs.writeFile("./data/accounts.json", JSON.stringify(accounts), err => {});

    // 入室情報をロビー閲覧者にemitする
    io.emit("receive_lobby", {
      roomId: roomId,
      room: rooms[roomId],
      flag: "user"
    });

    // 入室アナウンスのデータを作成
    let reply_data = {
      msg: "さんが入室しました。",
      name: accounts[req.user.id].user.name,
      timeStamp: timeStamp()
    };

    // 入室アナウンスをルームにemitする。
    io.emit("receive_chat_" + roomId, reply_data);

    // room.chatLogにpush
    rooms[roomId].chatLog.push(reply_data);

    // ログが10以上になったらroom.chatLot.shift()
    if (10 < rooms[roomId].chatLog.length) rooms[roomId].chatLog.shift();

    // rooms.jsonに書き込み。
    fs.writeFile("./data/rooms.json", JSON.stringify(rooms), err => {});

    // /room/:idへリダイレクト
    res.redirect("/room/" + roomId);
  }
);

// ルームから退出
app.get(
  "/room/:id([0-9]+)/exit",
  // ログイン済みかチェック。In
  loggedInInside,
  (req, res) => {
    var roomId = req.params.id - 0;
    // var membersId = rooms[roomId].membersId;

    // アカウント情報とルームIDが一致したら
    if (roomId === accounts[req.user.id].user.room.id) {
      // accountsデータから入室ルームidをロビー(0)に変更
      accounts[req.user.id].user.room.id = 0;

      // roomsデータからユーザー情報を削除
      rooms[roomId].membersId = rooms[roomId].membersId.filter(memberId => {
        return req.user.id !== memberId;
      });

      if (0 < rooms[roomId].membersId.length) {
        // ルーム内にだれか居る時

        // 退出情報をロビーにemitする。
        io.emit("receive_lobby", {
          roomId: roomId,
          room: rooms[roomId],
          flag: "user"
        });

        // 退出アナウンスのデータを作成
        let reply_data = {
          msg: "さんが退出しました。",
          name: accounts[req.user.id].user.name,
          timeStamp: timeStamp()
        };

        // 退出アナウンスをルームにemitする。
        io.emit("receive_chat_" + roomId, reply_data);

        // room.chatLogにpush
        rooms[roomId].chatLog.push(reply_data);

        // ログが10以上になったらroom.chatLot.shift()
        if (10 < rooms[roomId].chatLog.length) rooms[roomId].chatLog.shift();
      } else {
        // ルーム内に誰も居なくなった時

        // roomsデータからroomを削除
        delete rooms[roomId];

        // ルーム崩壊をロビーにemitする。
        io.emit("receive_lobby", { roomId: roomId, flag: "destroy" });
      }

      // rooms.jsonとaccounts.jsonを更新
      fs.writeFile("./data/accounts.json", JSON.stringify(accounts), err => {});
      fs.writeFile("./data/rooms.json", JSON.stringify(rooms), err => {});
    }

    // /lobbyへリダイレクト
    res.redirect("/lobby");
  }
);

// ロビー画面
app.get(
  "/lobby",
  // ログイン済みかチェック。In
  loggedInInside,
  (req, res) => {
    // game/lobby.ejsをレンダー
    var render_data = {
      user: accounts[req.user.id].user,
      rooms: rooms
    };
    res.render("game/lobby", render_data);
  }
);

// ログアウト
app.get("/logout", (req, res) => {
  // パスポートのログアウトメソッドを使う
  req.logout();

  // / へリダイレクト
  res.redirect("/");
});

/********************
 *  socket.IO
 ********************/

// リアルタイム閲覧者のリスト
// onlineUsers = [{userId, roomId, socketId}, ...]
let onlineUsers = [];
// observer(onlineUsers);

// 接続イベント 'connection'
//   io.on('connection', callback);
io.on("connection", socket => {
  // 切断イベント 'disconnect'
  socket.on("disconnect", reason => {
    let roomId;
    // 切断したら、オンライン閲覧者から削除する
    onlineUsers = onlineUsers.filter(data => {
      if (data.socketId == socket.id) {
        roomId = data.roomId;
        return false;
      } else {
        return true;
      }
    });

    // リアルタイム閲覧者の変化を送信
    io.emit("online_members_" + roomId, {
      usersName: sameRoomOnlineUsersName(roomId)
    });
  });

  /*** チャット ***/

  // チャットの初回読み込み
  //   load_chat -> chat_log
  socket.on("load_chat", data => {
    // ルームが存在しない時、キャンセル
    if (!existsRoom(data.roomId)) return false;

    // リアルタイム閲覧者のリストに登録
    onlineUsers.push({
      roomId: data.roomId,
      userId: data.userId,
      socketId: socket.id
    });

    // リアルタイム閲覧者の変化を送信
    io.emit("online_members_" + data.roomId, {
      usersName: sameRoomOnlineUsersName(data.roomId)
    });

    // ログを返送する。
    socket.emit("chat_log", rooms[data.roomId].chatLog);
  });

  // チャットの送受信
  // send_chat
  socket.on("send_chat", data => {
    // ルームが存在しない時、キャンセル
    if (!existsRoom(data.roomId)) return false;

    // 発言データを作成
    let reply_data = {
      msg: data.msg,
      name: data.name,
      timeStamp: timeStamp()
    };
    // チャット閲覧者にデータをemit
    socket.emit("receive_chat_" + data.roomId, reply_data);
    socket.broadcast.emit("receive_chat_" + data.roomId, reply_data);

    // room.chatLogにpush
    rooms[data.roomId].chatLog.push(reply_data);

    // ログが10以上になったらroom.chatLot.shift()
    if (10 < rooms[data.roomId].chatLog.length)
      rooms[data.roomId].chatLog.shift();

    // rooms.jsonに書き込み。
    fs.writeFile("./data/rooms.json", JSON.stringify(rooms), err => {});
  });

  /*** ゲーム ***/

  // ゲームの初回読み込み
  //   load_game -> game_log
  socket.on("load_game", data => {
    // ルームが存在しない時、キャンセル
    if (!existsRoom(data.roomId)) return false;
    socket.emit("game_log_" + data.roomId, rooms[data.roomId].status);
  });

  // ゲームが進んだ報告
  // step_game -> game_log
  socket.on("step_game", data => {
    // ルームが存在しない時、キャンセル
    if (!existsRoom(data.roomId)) return false;

    // ルームのゲーム情報を取得。
    let status = rooms[data.roomId].status;

    // プレイヤーが未登録だった場合
    if (status.playersId[status.turn] === -1) {
      // プレイヤーを登録
      status.playersId[status.turn] = data.userId;
      status.playersName[status.turn] = accounts[data.userId].user.name;

      // プレイヤーではない人だった場合
    } else if (data.userId !== status.playersId[status.turn]) {
      // なかったことにする
      return false;
    }

    // ゲームを進行させる
    status = stepGame(status, data.placeId);

    //ロボットのターンだった場合、それを処理する。
    if (isRobotTurn(status) && status.progress === "playing") {
      status = stepRobotTurn(status);
    }

    // 盤面の変化をrooms.jsonに反映・更新
    saveStatus(status, data.roomId);

    // ルーム閲覧者にデータをemit
    socket.emit("game_log_" + data.roomId, status);
    socket.broadcast.emit("game_log_" + data.roomId, status);
  });

  // 再戦
  socket.on("rematch_game", data => {
    // ルームが存在しない時、キャンセル
    if (!existsRoom(data.roomId)) return false;

    let status = {
      turn: 0,
      turnCount: 0,
      oxTable: [-1, -1, -1, -1, -1, -1, -1, -1, -1],
      playersId: [-1, -1],
      playersName: ["未定", "未定"],
      progress: "playing"
    };
    rooms[data.roomId].status = status;

    // 盤面の変化をrooms.jsonに反映・更新
    fs.writeFile("./data/rooms.json", JSON.stringify(rooms), err => {});

    socket.emit("rematch_" + data.roomId, status);
    socket.broadcast.emit("rematch_" + data.roomId, status);
  });

  // ロボット参戦
  socket.on("robot_participation", data => {
    // ルームが存在しない時、キャンセル
    if (!existsRoom(data.roomId)) return false;

    // ルームのゲーム情報を取得。
    let status = rooms[data.roomId].status;

    // 受け取ったデータをチェック
    // プレイヤーが未登録だった場合
    if (status.playersId[data.turn] === -1) {
      // ロボットを登録
      status.playersId[data.turn] = data.robotId;
      status.playersName[data.turn] = "ロボット";
    } else {
      // プレイヤーが登録済みならキャンセル。
      return false;
    }
    //ロボットのターンだった場合、それを処理する。
    if (isRobotTurn(status) && status.progress === "playing") {
      status = stepRobotTurn(status);
    }

    // データの変更をrooms.jsonに反映・更新
    saveStatus(status, data.roomId);

    // ルーム閲覧者にデータをemit
    socket.emit("game_log_" + data.roomId, status);
    socket.broadcast.emit("game_log_" + data.roomId, status);
  });
});

/********************
 *  listening
 ********************/

const listener = http.listen(process.env.PORT, () => {
  console.log("Your app is listening on port " + listener.address().port);
});

/********************
 *  Functions
 ********************/

/*** ルーティング関連 ***/

// ページのリクエストを貰ったとき認証済か確認する関数
// ログイン済みかチェック。In
function loggedInInside(req, res, next) {
  // 認証済だったら
  if (req.isAuthenticated()) {
    // usersから入室登録されているルームidをとる
    var roomInUser = accounts[req.user.id].user.room.id;

    // ルームが存在するかチェック
    if (existsRoom(roomInUser)) {
      // id===ロビー、または移動先と同じだった場合
      if (roomInUser === 0 || roomInUser === req.params.id - 0) {
        // そのまま次の処理へ
        return next();

        // ルーム移動しようとしている時
      } else {
        // 移動元のルームに戻す。
        res.redirect("/room/" + roomInUser);
      }

      // 存在しないルームが登録されていた時
    } else {
      //ロビーに移動させる。
      accounts[req.user.id].user.room.id = 0;
      fs.writeFile("./data/accounts.json", JSON.stringify(accounts), err => {});
      res.redirect("/lobby");
    }
  } else {
    // 未認証の場合
    res.redirect("/"); // TOP画面に遷移
  }
}

// ログイン済みかチェック。Out
function loggedInOutside(req, res, next) {
  // 認証済だったら
  if (req.isAuthenticated()) {
    // 入室登録されているルームidをとる
    var roomInUser = accounts[req.user.id].user.room.id;

    // ルームが存在するかチェック
    if (existsRoom(roomInUser)) {
      // ロビーにいる時
      if (roomInUser === 0) {
        // ロビー画面へ遷移
        res.redirect("/lobby");

        // ルームにいる時
      } else {
        // ルーム画面へ遷移
        res.redirect("/room/" + roomInUser);
      }

      // 存在しないルームが登録されていた時
    } else {
      //ロビーに移動させる。
      accounts[req.user.id].user.room.id = 0;
      fs.writeFile("./data/accounts.json", JSON.stringify(accounts), err => {});
      res.redirect("/lobby");
    }

    // 未認証の場合
  } else {
    // そのまま次の処理へ
    return next();
  }
}

// 存在しないルームに移動しようとしていないかチェック
function checkout(req, res, next) {
  if (existsRoom(req.params.id)) {
    next();
  } else {
    res.redirect("/lobby");
  }
}

// ルームが存在するかチェック true / false
function existsRoom(roomId) {
  if (rooms[roomId] == null) {
    return false;
  } else {
    return true;
  }
}

/*** チャット関連 ***/

function timeStamp() {
  let date = new Date();
  let timeStamp =
    date.getMonth() +
    1 +
    "/" +
    date.getDate() +
    " (" +
    "日月火水木金土"[date.getDay()] +
    ") " +
    ("0" + date.getHours()).substr(-2) +
    ":" +
    ("0" + date.getMinutes()).substr(-2);
  return timeStamp;
}

// オンライン閲覧者のidリストを出力
function sameRoomOnlineUsersName(roomId) {
  let resultUsersName = [];
  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].roomId === roomId) {
      resultUsersName.push(accounts[onlineUsers[i].userId].user.name);
    }
  }
  return resultUsersName;
}

/*** ゲーム関連 ***/

// 〇または×が３つ並んでいるかチェック
function isWin(oxTable) {
  var rowList = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];
  for (var i = 0; i < rowList.length; i++) {
    // 並び順のセットを一個ずつチェックする
    if (-1 < oxTable[rowList[i][0]]) {
      // １つ取り出し、空欄でないことをチェック
      // 空欄ではない何かが、３列並んでいるかチェック
      if (
        oxTable[rowList[i][0]] === oxTable[rowList[i][1]] &&
        oxTable[rowList[i][1]] === oxTable[rowList[i][2]]
      ) {
        return true;
      }
    }
  }
  return false;
}

// ロボットの手番かチェック
function isRobotTurn(status) {
  return status.playersId[status.turn] < -1;
}

// ロボットが打つ手をランダムに決める
function robotSelectId(status) {
  // 空いているセルのインデックスをリストアップする。
  let emptyCellsIndex = [];
  status.oxTable.forEach((element, index) => {
    if (element === -1) emptyCellsIndex.push(index);
  });

  // 空いている箇所からランダムに選択。
  let randomPlaceId =
    emptyCellsIndex[Math.floor(Math.random() * emptyCellsIndex.length)];

  return randomPlaceId;
}

// ロボットのターンを処理する
function stepRobotTurn(status) {
  // ロボットの手をランダムに選ぶ
  let placeId = robotSelectId(status);

  // ゲームを進行させる
  status = stepGame(status, placeId);

  return status;
}

// ゲームを進行させる
function stepGame(status, placeId) {
  // データを反映させる
  status.oxTable[placeId] = status.turn;

  // ターンカウントが4以上の時で、かつ誰かが勝ってたら
  if (3 < status.turnCount && isWin(status.oxTable)) {
    status.progress = "win";

    // もう置く場所がなかったら ドロー
  } else if (status.turnCount === 8) {
    status.progress = "draw";

    // ゲームが続行できる時は
  } else {
    status.progress = "playing";
    status.turnCount++;
    status.turn = status.turnCount % 2;
  }
  return status;
}

// データの変更をrooms.jsonに反映・更新
function saveStatus(status, roomId) {
  rooms[roomId].status = status;
  fs.writeFile("./data/rooms.json", JSON.stringify(rooms), err => {});
}

/********************
 *  Debugs
 ********************/

function observer(data, text = "Obs-No:", time = "3000") {
  let observerNumber = setInterval(() => {
    console.log(text + observerNumber);
    console.log(data);
    console.log("");
  }, time);
}

function debug_log(data, fileName = "log") {
  fs.writeFile(
    `./debug_logs/${fileName}.json`,
    JSON.stringify(jc.decycle(data)),
    err => {}
  );
}
