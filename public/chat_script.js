$(function () {
  // チャット初回読み込み申請
  socketIO.emit('load_chat', { roomId: user.room.id, userId: user.id });
  
  // チャット初回読み込みの受信
  socketIO.on('chat_log', function (data) {
    // もらったログを反映させる。
    var $logs = $('#logs');
    for (var i = 0; i < data.length; i++) {
      if (data[i].name === undefined) data[i].name = '名無し';
      $logs.append($('<li>').text(data[i].name + 'さん : ' + data[i].msg + data[i].timeStamp));
    }
  });

  // チャット発言
  $('#send_chat').submit(function (e) {
    e.preventDefault();

    // サーバーに発言内容を送る。
    socketIO.emit('send_chat', {
      name: user.name,
      msg: $('#msg').val(),
      roomId: user.room.id,
    });
    $('#msg').val('').focus();
  });

   // 新規チャット受信
  socketIO.on('receive_chat_' + user.room.id, (data) => {
    // 送られてきたデータに名前がない場合、名無し
    if (data.name === undefined) data.name = '名無し';
    // 新しいデータを追加する
    var $logs = $('#logs');
    $logs.append($('<li>').text(data.name + 'さん : ' + data.msg + " " + data.timeStamp));
    var $logs_li = $logs.find('li');
    // 10発言より多くなったら、古いのを削除。
    if (10 < $logs_li.length) $logs_li.eq(0).remove();
  });

  // リアルタイム閲覧者のリスト受信
  socketIO.on('online_members_' + user.room.id, (data) => {
    $('#online_user_list').text(data.usersName.join(', '));
  });
});