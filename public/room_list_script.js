$(function () {
  socketIO.on('receive_lobby', function (data) {
    let flag = data.flag,
        room = data.room;
    if (flag === "user") {  // 入退出
      $(`#room${room.id}Members`).text(room.membersId.length);
    } else if (flag === "create") {  // ルーム作成
      $('#room-list').append(
        $('<tr>')
          .attr('id', 'room' + room.id)
          .html(
            `<td>${room.name}</td>`
            + `<td><a class="btn" href="/room/${room.id}/enter">入室</a></td>`
            + `<td><span id="room${room.id}Members">${room.membersId.length}</span> / ${room.maxMembers}名</td>`
          )
      );

    } else if (flag === "destroy") {  // ルーム削除
      $('#room' + data.roomId).remove();
    }
  });
});

