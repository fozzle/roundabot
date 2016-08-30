const Youtube = require('youtube-api');
const keys = require('./keys');
const promisify = require('es6-promisify');
const moment = require('moment');
const request = require('request');
const Chance = require('chance');
const Twit = require('twit');
const fs = require('fs');
const exec = require('child_process').exec;

const twitter = new Twit({
  consumer_key: keys.TWITTER.CONSUMER_KEY,
  consumer_secret: keys.TWITTER.CONSUMER_SECRET,
  access_token: keys.TWITTER.ACCESS_TOKEN,
  access_token_secret: keys.TWITTER.ACCESS_SECRET,
});

module.exports.twitter = twitter;

const chance = new Chance();

const DURATION_MAX = 1000 * 50;
const DURATION_MIN = 1000 * 21;

module.exports.yt = Youtube.authenticate({
  type: 'key',
  key: keys.YOUTUBE,
});



module.exports.findVideos = () => {
  const query = chance.word();
  console.log(query);
  const videos = [];
  return promisify(Youtube.search.list)({
    part: 'id,snippet',
    type: 'video',
    q: query,
    videoDimension: '2d',
    videoDuration: 'short',
    maxResults: 50,
  })
    .then(data => {
      const ids = data.items.map(item => item.id.videoId);
      return promisify(Youtube.videos.list)({
        part: 'contentDetails',
        id: ids.join(','),
      });
    })
    .then(data => {
      const candidates = data.items.filter(item => {
        const duration = moment.duration(item.contentDetails.duration).asMilliseconds();
        return duration < DURATION_MAX && duration > DURATION_MIN;
      });
      return candidates;
    });
}

module.exports.downloadYoutube = (videoId) => {
  exec(`youtube-dl ${videoId} --recode-video mp4 -o scratch/vid.mp4`);
    // .then(() => 'scratch/vid.mp4');
}

module.exports.download = (uri, destination) => {
  return new Promise(function(resolve, reject) {
    request.head(uri, function(err, res, body){
      console.log('content-type:', res.headers['content-type']);
      console.log('content-length:', res.headers['content-length']);

      request(uri).pipe(fs.createWriteStream(destination)).on('close', function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(destination);
        }
      });
    });
  });
};

module.exports.getStill = (videoPath='scratch/vid.mp4', time='17', outPath='scratch/frame.png') => {
  // ffmpeg -i [video] -ss [time] -vframes 1 [output]
  console.log('getting still for ', videoPath, time, outPath);
  return new Promise((resolve, reject) => {
    const cmd = exec(`ffmpeg -y -i ${videoPath} -ss 00:00:${time} -vframes 1 ${outPath}`, (err, stdout) => {
      if (err) return reject(err);
    });
    cmd.on('close', code => {
      if (!code) return resolve(outPath);
      return reject(code);
    });
  });
}

module.exports.filterStill = (stillPath='scratch/frame.png', outPath='scratch/sepia.png') => {
  // ffmpeg -i frame.png -i tbc.png \
  // -filter_complex "[0:v]colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131[sepia]; \
  // [sepia]overlay=main_w-overlay_w-20:main_h-overlay_h-20[out]" -map "[out]" sepia.png
  console.log('filtering still')
  return new Promise((resolve, reject) => {
    const cmd = exec(`ffmpeg -y -i ${stillPath} -i tbc.png \
      -filter_complex "[0:v]colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131[sepia]; \
      [1:v][sepia]scale2ref=iw/4:ih/4*(${55}/${243})[tbc][0v]; \
      [0v][tbc]overlay=main_w-overlay_w-20:main_h-overlay_h-20[out]" -map "[out]" ${outPath}`, (err, stdout) => {
        if (err) return reject(err);
    });
    cmd.on('close', code => {
      if (!code) return resolve(outPath);
      return reject(code);
    });
  });
}

module.exports.stillToVideo = (stillPath='scratch/sepia.png', outPath='scratch/freeze.mp4') => {
  // ffmpeg -f lavfi -i aevalsrc=0 -loop 1 -i sepia.png -t 5 -c:v libx264 -c:a aac -strict experimental freeze.mp4
  console.log('still to video');
  return new Promise((resolve, reject) => {
    const cmd = exec(`ffmpeg -y -f lavfi -i aevalsrc=0 -loop 1 -i ${stillPath} -t 5 -c:v libx264 -c:a aac -strict experimental ${outPath}`, (err) => {
      if (err) return reject(err);
    });
    cmd.on('close', code => {
      if (!code) return resolve(outPath);
      return reject(code);
    });
  });
}

const audioLengthMs = 23.25 * 1000;
const dropTime = 16.7 * 1000;
module.exports.modifyRoundabout = (targetTime='17', outPath='scratch/roundabout.aac') => {
  console.log('roundabout aac', targetTime, dropTime)
  return new Promise((resolve, reject) => {
    let cmd;
    if (targetTime * 1000 > dropTime) {
      // If our cutoff time is bigger than our audio, pad audio at start by difference so that it syncs
      const padDuration = (targetTime * 1000 - dropTime)/1000;
      const ffmpeg = `ffmpeg -y -i roundabout.mp3 -filter_complex \
        "aevalsrc=0:d=${padDuration}[pad];\
        [pad][0]concat=n=2:v=0:a=1[out]" \
        -map "[out]" -c:a aac ${outPath}`;
      console.log(ffmpeg);
      cmd = exec(ffmpeg, (err) => {
          if (err) return reject(err);
      });
    } else {
      const ffmpeg = `ffmpeg -y -ss 00:00:${(dropTime - targetTime * 1000)/1000} -i roundabout.mp3 ${outPath}`;
      console.log(ffmpeg);
      // otherwise we need to seek the audio so that its shorter!
      cmd = exec(ffmpeg, (err) => {
        if (err) return reject(err);
      });
    }
    cmd.on('close', code => {
      if (!code) return resolve(outPath);
      return reject(code);
    });
  });
}

module.exports.concatVideos = (vidPath='scratch/vid.mp4', freezePath='scratch/freeze.mp4', audioPath='roundabout.mp3', time='17', outPath='scratch/jojo.mp4') => {
  // ffmpeg -i freeze.mp4 -t 17 -i vid.mp4 -i roundabout.mp3 -filter_complex \
  // "[1:0] [1:1] [0:0] [0:1] concat=n=2:v=1:a=1 [v] [a];\
  // [a][2:a] amerge=inputs=2 [merged]" \
  // -map "[v]" -map "[merged]" -c:v libx264 -q 1 -c:a aac -strict experimental jojo.mp4
  console.log('concat');
  return new Promise((resolve, reject) => {
    const ffmpeg = `ffmpeg -y -i ${freezePath} -t 00:00:${time} -i ${vidPath} -i ${audioPath} -filter_complex \
    "[1:0] [1:1] [0:0] [0:1] concat=n=2:v=1:a=1 [v] [a];\
    [a] volume=volume=0.6 [aq];\
    [aq][2:a] amix=inputs=2 [merged];\
    [v]scale=640:-1[scaled]" \
    -map "[scaled]" -map "[merged]" -c:v libx264 -pix_fmt yuv420p -q 1 \
    -c:a aac -vb 1024k -minrate 1024k -maxrate 1024k -bufsize 1024k -ar 44100 -ac 2 -strict experimental ${outPath}`;
    console.log(ffmpeg);
    const cmd = exec(ffmpeg, (err) => {
      if (err) return reject(err);
    });
    cmd.on('close', code => {
      if (!code) return resolve(outPath);
      return reject(code);
    });
  });
}

function uploadMedia(filename) {
  return new Promise(function (resolve, reject) {
    twitter.postMediaChunked({
        file_path: filename
      },
      function(error, data, resp) {
        console.log('uploaded', error, data);
        if (error || data.error) {
          reject(error || data.error);
        } else {
          resolve(data.media_id_string);
        }
      });
  });
}

const updateStatus = (mediaId, status="", replyTo="") => {
  return new Promise(function(resolve, reject) {
    console.log("posting status");
    const params = {
      status: status,
      in_reply_to_status_id: replyTo
    };
    if (mediaId) {
      params.media_ids = [mediaId];
    }
    twitter.post('statuses/update',
      params,
      function(error, data, resp) {
        if (error) {
          console.log("error updating status", error);
          reject(error);
        } else {
          resolve();
        }
      })
  });
}

module.exports.updateStatus = updateStatus;

module.exports.makeTweet = (videoPath, status = '', replyTo = '') => {
  // Make tweet out of scratch/jojo.mp4
  return uploadMedia(videoPath)
    .then(mediaId => updateStatus(mediaId, status, replyTo))
}

module.exports.clean = (dir='scratch/*') => {
  return exec(`rm -r ${dir}`);
}
