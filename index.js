const Youtube = require('youtube-api');
const keys = require('./keys');
const promisify = require('es6-promisify');
const moment = require('moment');
const Chance = require('chance');
const ffmpeg = require('fluent-ffmpeg');
const Twit = require('twit');
const exec = require('child_process').execSync;

const twitter = new Twit({
  consumer_key: keys.TWITTER.CONSUMER_KEY,
  consumer_secret: keys.TWITTER.CONSUMER_SECRET,
  access_token: keys.TWITTER.ACCESS_TOKEN,
  access_token_secret: keys.TWITTER.ACCESS_SECRET,
});

const chance = new Chance();

const DURATION_MAX = 1000 * 50;
const DURATION_MIN = 1000 * 21;

const yt = Youtube.authenticate({
  type: 'key',
  key: keys.YOUTUBE,
});



function findVideos() {
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

function downloadVideo(videoId) {
  exec(`youtube-dl ${videoId} --recode-video mp4 -o scratch/vid.mp4`);
    // .then(() => 'scratch/vid.mp4');
}

function getStill() {
  // ffmpeg -i vid.mp4 -ss 00:00:17 -vframes 1 frame.png
  console.log('getting still');
  exec('ffmpeg -y -i scratch/vid.mp4 -ss 00:00:17 -vframes 1 scratch/frame.png');
}

function filterStill() {
  // ffmpeg -i frame.png -i tbc.png \
  // -filter_complex "[0:v]colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131[sepia]; \
  // [sepia]overlay=main_w-overlay_w-20:main_h-overlay_h-20[out]" -map "[out]" sepia.png
  console.log('filtering still');
  exec('ffmpeg -y -i scratch/frame.png -i tbc.png \
  -filter_complex "[0:v]colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131[sepia]; \
  [sepia]overlay=main_w-overlay_w-20:main_h-overlay_h-20[out]" -map "[out]" scratch/sepia.png');
}

function stillToVideo() {
  console.log('still to video');
  // ffmpeg -f lavfi -i aevalsrc=0 -loop 1 -i sepia.png -t 5 -c:v libx264 -c:a aac -strict experimental freeze.mp4
  exec('ffmpeg -y -f lavfi -i aevalsrc=0 -loop 1 -i scratch/sepia.png -t 5 -c:v libx264 -c:a aac -strict experimental scratch/freeze.mp4');
}

function concatVideos() {
  // ffmpeg -i freeze.mp4 -t 17 -i vid.mp4 -i roundabout.mp3 -filter_complex \
  // "[1:0] [1:1] [0:0] [0:1] concat=n=2:v=1:a=1 [v] [a];\
  // [a][2:a] amerge=inputs=2 [merged]" \
  // -map "[v]" -map "[merged]" -c:v libx264 -q 1 -c:a aac -strict experimental jojo.mp4
  exec('ffmpeg -y -i scratch/freeze.mp4 -t 17 -i scratch/vid.mp4 -i roundabout.mp3 -filter_complex \
  "[1:0] [1:1] [0:0] [0:1] concat=n=2:v=1:a=1 [v] [a];\
  [a][2:a] amerge=inputs=2 [merged];\
  [v]scale=640:-1[scaled]" \
  -map "[scaled]" -map "[merged]" -c:v libx264 -pix_fmt yuv420p -q 1 \
  -c:a aac -vb 1024k -minrate 1024k -maxrate 1024k -bufsize 1024k -ar 44100 -ac 2 -strict experimental scratch/jojo.mp4');
}

function makeJojo(videoPath) {
  // Run our collection of ffmpeg spells, all sync lol
  getStill()
  filterStill()
  stillToVideo()
  concatVideos()
  return Promise.resolve();
};

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

function updateStatus(media_id, status) {
  return new Promise(function(resolve, reject) {
    console.log("posting status");
    twitter.post('statuses/update',
      {
        status: status || "",
        media_ids: [media_id]
      },
      function(error, data, resp) {
        if (error) {
          console.log("error updating status");
          reject(error);
        } else {
          resolve();
        }
      })
  });
}

function makeTweet(videoPath) {
  // Make tweet out of scratch/jojo.mp4
  return uploadMedia('scratch/jojo.mp4')
    .then(updateStatus)
}

function clean() {
  return exec('rm -r scratch/*');
}

// For a lack of a better word
function main() {
  findVideos()
    .then(videos => {
      if (!videos.length) {
        main();
        throw new Error('no vids');
      }

      // Select random video
      const video = videos[Math.floor(Math.random() * videos.length)];
      // Youtube-dl to scratch folder as vid.mp4
      return downloadVideo(video.id);
    })
    .then(path => {
      console.log(path);
      return makeJojo(path);
    })
    .then(jojoPath => {
      return makeTweet(jojoPath);
    })
    .then(clean)
    .catch(err => {
      console.log(err);
    })

}


main();
