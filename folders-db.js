'use strict'
var Pool = require('pg').Pool
var lib = require('http-helper-functions')
const db = require('./folders-pg.js')

function withErrorHandling(req, res, callback) {
  return function (err) {
    if (err == 404) 
      lib.notFound(req, res)
    else if (err)
      lib.internalError(res, err)
    else 
      callback.apply(this, Array.prototype.slice.call(arguments, 1))
  }
}

function createFolderThen(req, res, id, selfURL, folder, callback) {
  db.createFolderThen(req, id, selfURL, folder, withErrorHandling(req, res, callback))
}

function withFolderDo(req, res, id, callback) {
  db.withFolderDo(req, id, withErrorHandling(req, res, callback))
}

function deleteFolderThen(req, res, id, callback) {
  db.deleteFolderThen(req, id, withErrorHandling(req, res, callback))
}

function updateFolderThen(req, res, id, folder, patchedFolder, etag, callback) {
  db.updateFolderThen(req, id, folder, patchedFolder, etag, withErrorHandling(req, res, callback))
}

function init(callback) {
  db.init(callback)
}

exports.createFolderThen = createFolderThen
exports.updateFolderThen = updateFolderThen
exports.deleteFolderThen = deleteFolderThen
exports.withFolderDo = withFolderDo
exports.init = init