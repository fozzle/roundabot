const Datastore = require('nedb');
const db = new Datastore({ filename: 'database', autoload: true });
const jojo = require('./jojo');
const twitter = jojo.twitter;
const exec = require('child_process').exec;
const promisify = require('es6-promisify');
const XmlEntities = require('html-entities').XmlEntities;
const entities = new XmlEntities();

let lock = false;
const queue = [];

function createJojobFromTweet(tweet) {
  // ugh. basically if there isnt just a single video, bail. (no reply because...?)
  if (!tweet.extended_entities ||
    !tweet.extended_entities.media ||
    !(tweet.extended_entities.media.length === 1) ||
    !tweet.extended_entities.media[0].video_info) return {};

  const videoInfo = tweet.extended_entities.media[0].video_info;

  // No long videos, but also nothing too short...
  if (videoInfo.duration_millis < 8 * 1000) {
    throw new Error(`@${tweet.user.screen_name} this video duration is too short, at least 8s please.`);
  } else if (videoInfo.duration_millis > 60 * 1000) {
    throw new Error(`@${tweet.user.screen_name} this video duration is too long, under 1 minute please.`);
  }

  // get mp4 video links
  console.log(tweet.id_str, videoInfo.variants);
  const mp4s = videoInfo.variants.filter(video => video.content_type === 'video/mp4');

  console.log(mp4s);
  // Find best quality
  var video = mp4s.reduce(function(prev, current) {
    return (prev.bitrate > current.bitrate) ? prev : current;
  });

  console.log(video);

  // Try and parse out a valid timestamp
  const text = entities.decode(tweet.text);
  const timeMatch = text.match(/\<(\d+(\.\d+)?)\>/);
  let time = (videoInfo.duration_millis - 100)/1000;
  if (timeMatch) {
    const x = Number(timeMatch[1]);
    if (x && !isNaN(x)) {
      time = x;
    } else {
      throw new Error(`@${tweet.user.screen_name} I couldn't make sense of this timestamp.`);
    }

    if (time * 1000 > videoInfo.duration_millis) {
      throw new Error(`@${tweet.user.screen_name} this timestamp is too long sorry!`);
    }
  }

  // Hooray we made it!
  return { id: tweet.id_str, url: video.url, time, username: tweet.user.screen_name };
}

function scanMentions() {
  // todo: get rid of callback hell lol.
  twitter.get('statuses/mentions_timeline', { include_entities: true }, (err, mentions) => {
    console.log(mentions.map(x => x.id_str));
    mentions.forEach(tweet => {
      db.find({ _id: tweet.id_str }, (err, docs) => {
        // Don't process ids we have seen/are in queue
        if (docs.length) return;

        // Otherwise add to work queue if VALID.
        db.insert({ _id: tweet.id_str }, (err, doc) => {
          let jobObject = {};
          try {
            jobObject = createJojobFromTweet(tweet);
          } catch (e) {
            console.error(e);
            jojo.updateStatus(undefined, e.message, tweet.id_str);
            return;
          }

          // Sanity check
          if (Object.keys(jobObject).length !== 4) return;
          queue.push(jobObject);
        });
      });
    });
  });
};

function clean() {
  return new Promise((resolve, reject) => {
    exec('rm -r user_scratch/*', (err, stdout, stderr) => {
      if (err) return reject(err);

      return resolve('cleaned');
    });
  });
}

function processQueue() {
  if (lock) return;
  const video = queue.shift();
  if (!video) return;
  lock = true;

  console.log(video);
  jojo.download(video.url, `user_scratch/${video.id}.mp4`)
    .then(filePath => jojo.getStill(filePath, video.time, `user_scratch/${video.id}-still.png`))
    .then(filePath => jojo.filterStill(filePath, `user_scratch/${video.id}-sepia.png`))
    .then(filePath => jojo.stillToVideo(filePath, `user_scratch/${video.id}-freeze.mp4`))
    .then(filePath => Promise.all([
      jojo.modifyRoundabout(video.time, `user_scratch/${video.id}.aac`),
      filePath,
    ]))
    .then(results => {
      const [audioPath, filePath] = results;
      return jojo.concatVideos(`user_scratch/${video.id}.mp4`, filePath, audioPath, video.time, `user_scratch/${video.id}-jojo.mp4`);
    })
    .then(finalVideo => {
      return jojo.makeTweet(finalVideo, `@${video.username}`, video.id);
    })
    .then(() => clean())
    .then(() => {
      lock = false;
    })
    .catch(err => {
      clean();
      lock = false;
      console.error(err);
    });
}

setInterval(processQueue, 2000);
setInterval(scanMentions, 60 * 1000 * 2);
scanMentions();
