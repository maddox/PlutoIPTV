#!/usr/bin/env node

const request = require('request');
const j2x = require('jsontoxml');
const moment = require('moment');
const fs = require('fs-extra');
const uuid4 = require('uuid').v4;
const uuid1 = require('uuid').v1;
const url = require('url');

const plutoIPTV = {
  grabJSON: function (callback) {
    callback = callback || function () {};

    console.log('[INFO] Grabbing EPG...');

    // check for cache
    if (fs.existsSync('cache.json')) {
      let stat = fs.statSync('cache.json');

      let now = new Date() / 1000;
      let mtime = new Date(stat.mtime) / 1000;

      // it's under 30 mins old
      if (now - mtime <= 1800) {
        console.log("[DEBUG] Using cache.json, it's under 30 minutes old.");

        callback(false, fs.readJSONSync('cache.json'));
        return;
      }
    }

    // 2020-03-24%2021%3A00%3A00.000%2B0000
    let startTime = encodeURIComponent(
      moment().format('YYYY-MM-DD HH:00:00.000ZZ')
    );

    // 2020-03-25%2005%3A00%3A00.000%2B0000
    let stopTime = encodeURIComponent(
      moment().add(36, 'hours').format('YYYY-MM-DD HH:00:00.000ZZ')
    );

    let url = `http://api.pluto.tv/v2/channels?start=${startTime}&stop=${stopTime}`;

    console.log(url);

    request(url, function (err, code, raw) {
      console.log('[DEBUG] Using api.pluto.tv, writing cache.json.');
      fs.writeFileSync('cache.json', raw);

      callback(err || false, JSON.parse(raw));
      return;
    });
  },
};

module.exports = plutoIPTV;

plutoIPTV.grabJSON(function (err, channels) {
  ///////////////////
  // M3U8 Playlist //
  ///////////////////

  let m3u8 = '#EXTM3U\n\n';
  channels.forEach((channel) => {
    let deviceId = uuid1();
    let sid = uuid4();
    if (channel.isStitched) {
      let m3uUrl = new URL(channel.stitched.urls[0].url);
      let queryString = url.search;
      let params = new URLSearchParams(queryString);

      // set the url params
      params.set('advertisingId', '');
      params.set('appName', 'web');
      params.set('appVersion', 'unknown');
      params.set('appStoreUrl', '');
      params.set('architecture', '');
      params.set('buildVersion', '');
      params.set('clientTime', '0');
      params.set('deviceDNT', '0');
      params.set('deviceId', deviceId);
      params.set('deviceMake', 'Chrome');
      params.set('deviceModel', 'web');
      params.set('deviceType', 'web');
      params.set('deviceVersion', 'unknown');
      params.set('includeExtendedEvents', 'false');
      params.set('sid', sid);
      params.set('userId', '');
      params.set('serverSideAds', 'true');

      m3uUrl.search = params.toString();
      m3uUrl = m3uUrl.toString();

      let slug = channel.slug;
      let logo = channel.colorLogoPNG.path;
      let group = channel.category;
      let name = channel.name;
      let art = channel.featuredImage.path.replace("w=1600", "w=1000").replace("h=900", "h=562");
      let guideDescription = channel.summary.replace(/(\r\n|\n|\r)/gm," ").replace('"', '').replace("”", "")
      let channelNumberTag;

      m3u8 =
        m3u8 +
        `#EXTINF:0 channel-id="${slug}" tvg-logo="${logo}" tvc-guide-art="${art}" tvc-guide-title="${name}" tvc-guide-description="${guideDescription}" group-title="${group}", ${name}
${m3uUrl}

`;
      console.log('[INFO] Adding ' + channel.name + ' channel.');

    } else {
      console.log("[DEBUG] Skipping 'fake' channel " + channel.name + '.');
    }

  });

  ///////////////////////////
  // XMLTV Programme Guide //
  ///////////////////////////
  let tv = [];

  //////////////
  // Channels //
  //////////////
  channels.forEach((channel) => {
    if (channel.isStitched) {
      tv.push({
        name: 'channel',
        attrs: { id: channel.slug },
        children: [
          { name: 'display-name', text: channel.name },
          { name: 'display-name', text: channel.number },
          { name: 'desc', text: channel.summary },
          { name: 'icon', attrs: { src: channel.solidLogoPNG.path } },
        ],
      });

      //////////////
      // Episodes //
      //////////////
      if (channel.timelines) {
        channel.timelines.forEach((programme) => {
          console.log(
            '[INFO] Adding instance of ' +
              programme.title +
              ' to channel ' +
              channel.name +
              '.'
          );

          tv.push({
          let isMovie = programme.episode.series.type == "film";
          let airingArt
          if (isMovie) {
            airingArt = programme.episode.poster.path
          } else {
            airingArt = programme.episode.series.tile.path.replace("w=660", "w=900").replace("h=660", "h=900")
          }
            name: 'programme',
            attrs: {
              start: moment(programme.start).format('YYYYMMDDHHmmss ZZ'),
              stop: moment(programme.stop).format('YYYYMMDDHHmmss ZZ'),
              channel: channel.slug,
            },
            children: [
              { name: 'title', attrs: { lang: 'en' }, text: programme.title },
              { name: 'icon', attrs: { src: airingArt } },
              {
                name: 'sub-title',
                attrs: { lang: 'en' },
                text:
                  programme.title == programme.episode.name
                    ? ''
                    : programme.episode.name,
              },
              {
                name: 'desc',
                attrs: { lang: 'en' },
                text: programme.episode.description,
              },
              {
                name: 'date',
                text: moment(programme.episode.firstAired).format('YYYYMMDD'),
              },
              {
                name: 'category',
                attrs: { lang: 'en' },
                text: isMovie ? "Movie" : "Series",
              },
              {
                name: 'category',
                attrs: { lang: 'en' },
                text: programme.episode.genre,
              },
              {
                name: 'category',
                attrs: { lang: 'en' },
                text: programme.episode.subGenre,
              },
              {
                name: 'episode-num',
                attrs: { system: 'onscreen' },
                text: programme.episode.number,
              },
            ],
          });
        });
      }
    }
  });

  let epg = j2x(
    { tv },
    {
      prettyPrint: true,
      escape: true,
    }
  );

  fs.writeFileSync('epg.xml', epg);
  console.log('[SUCCESS] Wrote the EPG to epg.xml!');

  fs.writeFileSync('playlist.m3u', m3u8);
  console.log('[SUCCESS] Wrote the M3U8 tuner to playlist.m3u8!');
});
