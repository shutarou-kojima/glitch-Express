$(function () {
  var emptyP1 = true;
  var emptyP2 = true;

  // サーバーにデータ送信を依頼
  socketIO.emit('load_game', { roomId: user.room.id });

  // サーバーからデータを受信
  socketIO.on('game_log_' + user.room.id, (status) =>  {

    
    // プレイヤーが登録済みなら
    if(emptyP1 && status.playersId[0] !== -1){
      // ロボット参戦を隠す。
      $('#first-robot-participation').hide();
      // 受け取ったプレイヤー名を画面に反映
      $('#circle-player-name').text(status.playersName[0]);
      // 未登録フラグを降ろす
      emptyP1 = false;
      // ロボットだった場合は、ロボ参戦を隠す
      if(status.playersId[0] < -1) $('.robot-participation').hide();
    }
    if(emptyP2 && status.playersId[1] !== -1){
      // ロボット参戦を隠す。
      $('#second-robot-participation').hide();
      // 受け取ったプレイヤー名を画面に反映
      $('#cross-player-name').text(status.playersName[1]);
      // 未登録フラグを降ろす
      emptyP2 = false;
      // ロボットだった場合は、ロボ参戦を隠す
      if(status.playersId[1] < -1) $('.robot-participation').hide();
    }

    // 受け取った盤面データを画面に反映
    for (var i = 0; i < status.oxTable.length; i++) {
      switch (status.oxTable[i]) {
        case 0: // 先手 〇 0
          $('#c' + i).text('〇').attr('class', 'piece circle');
          break;
        case 1: // 後手 × 1 
          $('#c' + i).text('×').attr('class', 'piece cross');
          break;
        default:
      }
    }

    // progressから勝敗を判定
    switch (status.progress) {

      //　誰かが勝って終わった時
      case "win":
        stopGame();
        showWinner(status.turn);
        break;

      //　ゲームがドローで終わった時
      case "draw":
        stopGame();
        showDraw();
        break;

      // ゲーム進行中
      case "playing":
        let turnPlayerId = status.playersId[status.turn];

        // ターンプレイヤーの場合
        if (turnPlayerId === user.id) {
          enableSelect();

          // ターンプレイヤーが不在で、プレイヤーでない場合
        } else if (turnPlayerId === -1 && status.playersId.indexOf(user.id) === -1) {
          enableSelect();

          // それ以外
        } else {
          disableSelect();
        }
    }
  });

  // サーバーから再戦を受信
  socketIO.on('rematch_' + user.room.id, (status)=> {

    // 表示の初期化
    $('#circle-player-name').text(status.playersName[0]);
    $('#cross-player-name').text(status.playersName[1]);
    $('.robot-participation').show();
    $('.ox td').text('').attr('class', 'selectable');
    $('.loser').attr('class', '');
    $('.end').html('');
    emptyP1 = emptyP2 = true;
  });

  // 盤面に〇×を置く機能を、selectableクラスに登録。
  $(document).on('click', '.selectable', function () {
    $this = $(this);
    var id = $this.data('id');

    // 置いた情報をサーバーに送信する。
    socketIO.emit('step_game',
      {
        roomId: user.room.id,
        userId: user.id,
        placeId: id
      });
  });

  // ロボット参戦ボタン
  $(document).on('click', '.robot-participation', function(){
    $this = $(this);
    var robotId = $this.data('robot-id');
    var turn = $this.data('turn') - 0;
    
    // 参戦したロボットのユーザーIDをサーバーに送信する。
    socketIO.emit('robot_participation',
    {
      roomId: user.room.id,
      robotId: robotId,
      turn: turn
    });
  });

  /**********
  * 以下関数 *
  ***********/

  // 選択箇所をON/OFFする
  function enableSelect() {
    // 一時的にクリック不可能にした要素をクリック可能にする。
    $('.empty').addClass('selectable').removeClass('empty');
  }

  function disableSelect() {
    // クリック可能な要素を一時的にクリック不可能にする。
    $('.selectable').addClass('empty').removeClass('selectable');
  }

  // ゲームの進行を止める。
  function stopGame() {
    // クリック可能な要素を不可能にする。
    $('.selectable').removeClass('selectable');

    // 再戦ボタンの作成
    var $rematch = $('<div>')
      .addClass('btn')
      .text('再戦')
      .on('click', function () {
        // 表示の初期化
        $('.ox td').text('').attr('class', 'selectable');
        $('.loser').attr('class', '');
        $('.end').html('');

        // 再戦をサーバーに通知
        socketIO.emit('rematch_game',
          {
            roomId: user.room.id,
            userId: user.id
          });
      });

    // 再戦ボタンの配置
    $('#rematch').append($rematch);
  }

  // 勝者のアナウンスをする。
  function showWinner(turn) {
    // Winner!を表示
    var $award = $('<div>').addClass('award').text('Winner!');
    $('#result').append($award);
    
    // 終了時のターンから、負けたほうのプレイヤーの表示を小さくする。
    if (turn === 0) {
      $('#second-player').addClass('loser');
    } else {
      $('#first-player').addClass('loser');
    }
  }

  // ドローのアナウンスをする。
  function showDraw() {
    // Draw! を表示する。
    var $draw = $('<div>').addClass('draw').text('Draw!');
    $('#result').append($draw);
  }
});