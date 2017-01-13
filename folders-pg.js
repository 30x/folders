'use strict'
var Pool = require('pg').Pool
var lib = require('http-helper-functions')
var pge = require('pg-event-producer')

var config = {
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE
}

var pool = new Pool(config)
var eventProducer = new pge.eventProducer(pool)

function createFolderThen(req, id, selfURL, folder, callback) {
  var query = `INSERT INTO folders (id, etag, data) values('${id}', 1, '${JSON.stringify(folder)}') RETURNING etag`
  function eventData(pgResult) {
    return {id: selfURL, action: 'create', etag: pgResult.rows[0].etag, folder: folder}
  }
  eventProducer.queryAndStoreEvent(req, query, 'folders', eventData, function(err, pgResult, pgEventResult) {
    callback(err, pgResult.rows[0].etag)
  })
}

function withFolderDo(req, id, callback) {
  pool.query('SELECT etag, data FROM folders WHERE id = $1', [id], function (err, pg_res) {
    if (err) {
      callback(500)
    }
    else {
      if (pg_res.rowCount === 0) { 
        callback(404)
      }
      else {
        var row = pg_res.rows[0]
        callback(null, row.data, row.etag)
      }
    }
  })
}

function deleteFolderThen(req, id, callback) {
  var query = `DELETE FROM folders WHERE id = '${id}' RETURNING *`
  function eventData(pgResult) {
    return {id: id, action: 'delete', etag: pgResult.rows[0].etag, folder: pgResult.rows[0].data}
  }
  eventProducer.queryAndStoreEvent(req, query, 'folders', eventData, function(err, pgResult, pgEventResult) {
    if (err)
      callback(err)
    else
      callback(err, pgResult.rows[0].data, pgResult.rows[0].etag)
  })
}

function updateFolderThen(req, id, folder, patchedFolder, etag, callback) {
  var key = lib.internalizeURL(id, req.headers.host)
  var query = `UPDATE folders SET (etag, data) = (${(etag+1) % 2147483647}, '${JSON.stringify(patchedFolder)}') WHERE id = '${key}' AND etag = ${etag} RETURNING etag`
  function eventData(pgResult) {
    return {id: id, action: 'update', etag: pgResult.rows[0].etag, before: folder, after: patchedFolder}
  }
  eventProducer.queryAndStoreEvent(req, query, 'folders', eventData, function(err, pgResult, pgEventResult) {
    if (err)
      callback(err)
    else
      callback(err, pgResult.rows[0].etag)
  })
}

function init(callback) {
  var query = 'CREATE TABLE IF NOT EXISTS folders (id text primary key, etag int, data jsonb)'
  pool.query(query, function(err, pgResult) {
    if(err)
      console.error('error creating folders table', err)
    else {
      console.log(`connected to PG at ${config.host}`)
      eventProducer.init(callback)
    }
  })    
}

process.on('unhandledRejection', function(e) {
  console.log(e.message, e.stack)
})

exports.createFolderThen = createFolderThen
exports.updateFolderThen = updateFolderThen
exports.deleteFolderThen = deleteFolderThen
exports.withFolderDo = withFolderDo
exports.init = init