const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Danh sách người chơi trên SERVER CHUNG
const players = {};
const MAX_HP = 100;

io.on('connection', (socket) => {
  console.log('🟢 Player connected:', socket.id);

  // Tạo người chơi mới với vị trí spawn ngẫu nhiên
  players[socket.id] = {
    id: socket.id,
    x: (Math.random() - 0.5) * 40,
    y: 1.7,
    z: (Math.random() - 0.5) * 40,
    rx: 0, ry: 0,
    hp: MAX_HP,
    weapon: 'ak47',
    kills: 0,
    deaths: 0,
    color: Math.floor(Math.random() * 0xffffff)
  };

  // Gửi danh sách người chơi hiện tại cho người mới
  socket.emit('init', { self: players[socket.id], players });
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // Cập nhật vị trí real-time
  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.x = data.x; p.y = data.y; p.z = data.z;
    p.rx = data.rx; p.ry = data.ry;
    p.weapon = data.weapon;
    socket.broadcast.emit('playerMoved', p);
  });

  // Xử lý bắn
  socket.on('shoot', (data) => {
    const shooter = players[socket.id];
    if (!shooter) return;

    // Broadcast hiệu ứng đạn cho người khác
    socket.broadcast.emit('playerShot', {
      id: socket.id,
      weapon: data.weapon,
      origin: data.origin,
      dir: data.dir
    });

    // Kiểm tra trúng đạn (raycast đơn giản phía server)
    if (data.weapon === 'ak47' || data.weapon === 'pistol') {
      let closest = null, closestDist = Infinity;
      Object.values(players).forEach((target) => {
        if (target.id === socket.id || target.hp <= 0) return;
        const dist = raySphereHit(data.origin, data.dir, target, 0.6);
        if (dist && dist < closestDist) { closestDist = dist; closest = target; }
      });

      if (closest) {
        const dmg = data.weapon === 'ak47' ? 34 : 22;
        closest.hp -= dmg;
        io.to(closest.id).emit('damaged', { hp: closest.hp, by: socket.id });

        if (closest.hp <= 0) {
          closest.hp = MAX_HP;
          closest.deaths++;
          shooter.kills++;
          closest.x = (Math.random() - 0.5) * 40;
          closest.z = (Math.random() - 0.5) * 40;
          io.emit('killFeed', { killer: shooter.id, victim: closest.id });
          io.to(closest.id).emit('respawn', { hp: MAX_HP, x: closest.x, z: closest.z, kills: closest.kills, deaths: closest.deaths });
          io.to(shooter.id).emit('scoreUpdate', { kills: shooter.kills, deaths: shooter.deaths });
        }
      }
    }

    // Dao (cận chiến)
    if (data.weapon === 'knife') {
      Object.values(players).forEach((target) => {
        if (target.id === socket.id || target.hp <= 0) return;
        const dx = target.x - shooter.x, dz = target.z - shooter.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist < 2.5) {
          target.hp -= 60;
          io.to(target.id).emit('damaged', { hp: target.hp, by: socket.id });
          if (target.hp <= 0) {
            target.hp = MAX_HP; target.deaths++; shooter.kills++;
            target.x = (Math.random() - 0.5) * 40;
            target.z = (Math.random() - 0.5) * 40;
            io.emit('killFeed', { killer: shooter.id, victim: target.id });
            io.to(target.id).emit('respawn', { hp: MAX_HP, x: target.x, z: target.z, kills: target.kills, deaths: target.deaths });
            io.to(shooter.id).emit('scoreUpdate', { kills: shooter.kills, deaths: shooter.deaths });
          }
        }
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 Player left:', socket.id);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

// Raycast vs sphere (hitbox đơn giản)
function raySphereHit(origin, dir, target, radius) {
  const ox = target.x - origin.x;
  const oy = (target.y + 1.2) - origin.y;
  const oz = target.z - origin.z;
  const t = ox*dir.x + oy*dir.y + oz*dir.z;
  if (t < 0) return null;
  const cx = ox - dir.x*t, cy = oy - dir.y*t, cz = oz - dir.z*t;
  const d2 = cx*cx + cy*cy + cz*cz;
  if (d2 > radius*radius) return null;
  return t;
}

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));