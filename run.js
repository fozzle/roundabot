const jojo = require('./jojo');

function makeJojo(videoPath) {
  // Run our collection of ffmpeg spells, all sync lol
  return jojo.getStill()
    .then(() => jojo.filterStill())
    .then(() => jojo.stillToVideo())
    .then(() => jojo.concatVideos());
};

// For a lack of a better word
function main() {
  jojo.findVideos()
    .then(videos => {
      if (!videos.length) {
        main();
        throw new Error('no vids');
      }

      // Select random video
      const video = videos[Math.floor(Math.random() * videos.length)];
      // Youtube-dl to scratch folder as vid.mp4
      return jojo.downloadVideo(video.id);
    })
    .then(path => {
      console.log(path);
      return makeJojo(path);
    })
    .then(jojoPath => {
      return jojo.makeTweet(jojoPath);
    })
    .then(() => jojo.clean())
    .catch(err => {
      console.log(err);
      jojo.clean();
    })
}

main();
