const dgram = require("dgram");
const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*",
  },
  perMessageDeflate: false,
});
const api = require("./api");
const constants = require("./constants");
const binutils = require("binutils");
const utf8 = require("utf8-bytes");

const PORT = 9000;
const LOCAL_PORT = 9001;
var HOST;
//const HOST = "192.168.8.103";
// const HOST = '';
const DISPLAY_NAME = "your";
const CONNECTION_PASSWORD = "asd";
const COMMAND_PASSWORD = "";
const onClientConnectedCallback = (callback) => {
  console.log(`I'm connected to ACC!`, callback);
};

let browserSocket;

var connectionId = "";
var entryListCars = [];
var carUpdates = [];
var carUpdatesCounter = 0;
var carEntryCount = 0;
var entryListCarCount = 0;
var lastEntrylistRequest = 0;
var cameraDefault;
var cameraSetDefault;
var focusedCarIndex;

const acc = dgram.createSocket("udp4");
acc.bind(LOCAL_PORT);

acc.on("message", (message) => {
  //console.log(`raw message: ${message}`);
  const reader = new binutils.BinaryReader(message, "little");

  const messageType = reader.ReadBytes(1).readUInt8(0);
  switch (messageType) {
    case constants.InboundMessageTypes.REGISTRATION_RESULT: {
      if (connectionId !== "") {
        requestDisconnect();
      }
      console.log("REGISTRATION_RESULT");
      connectionId = reader.ReadInt32();
      const connectionSuccess = reader.ReadBytes(1).readUInt8(0) > 0;
      const isReadonly = reader.ReadBytes(1).readUInt8(0) === 0;
      const errMsg = api.readString(reader);

      console.log({ connectionId, connectionSuccess, isReadonly, errMsg });

      requestEntryList();
      requestTrackData();

      if (connectionSuccess) {
        io.emit("connected");
      }
      break;
    }
    case constants.InboundMessageTypes.ENTRY_LIST: {
      console.log("Entry List");
      entryListCars = [];

      var cID = reader.ReadInt32();
      carEntryCount = reader.ReadUInt16();
      for (let i = 0; i < carEntryCount; i++) {
        entryListCars.push({ carIndex: reader.ReadUInt16() });
      }

      //console.log(entryListCars);
      /*io.emit("entryList", {
        entryList: entryListCars,
        carEntryCount: carEntryCount,
      });
*/
      break;
    }
    case constants.InboundMessageTypes.ENTRY_LIST_CAR: {
      //working
      //console.log("Entry List Cars");

      let carInfo = {};
      carInfo.carIndex = reader.ReadUInt16();
      carInfo.CarModelType = reader.ReadBytes(1).readUInt8(0);
      carInfo.TeamName = ReadString(reader);
      carInfo.RaceNumber = reader.ReadInt32();
      carInfo.CupCategory = reader.ReadBytes(1).readUInt8(0); // Cup: Overall/Pro = 0, ProAm = 1, Am = 2, Silver = 3, National = 4
      carInfo.CurrentDriverIndex = reader.ReadBytes(1).readUInt8(0);
      carInfo.Nationality = reader.ReadUInt16();
      carInfo.drivers = [];

      var driversOnCarCount = reader.ReadBytes(1).readUInt8(0);
      for (let di = 0; di < driversOnCarCount; di++) {
        var driverInfo = {};

        driverInfo.FirstName = ReadString(reader);
        driverInfo.LastName = ReadString(reader);
        driverInfo.ShortName = ReadString(reader);
        driverInfo.Category = reader.ReadBytes(1).readUInt8(0);

        driverInfo.Nationality = reader.ReadUInt16();

        carInfo.drivers.push(driverInfo);
      } // working ^

      //let index = entryListCars.findIndex((x) => x.carIndex == carId);
      //entryListCars[index] = { carIndex: carId, carInfo: carInfo };
      //console.log(entryListCars[index].carInfo.drivers);

      //Send Entry list cars to frontend
      //io.emit("carInfo", carInfo);

      //add to entryListCars
      entryListCars.map((x) => {
        if (x.carIndex === carInfo.carIndex) {
          x.carInfo = carInfo;
          entryListCarCount++;
        }
      })

      break;
    }
    case constants.InboundMessageTypes.REALTIME_UPDATE: {
      //working
      //console.log("REALTIME_UPDATE");
      realTimeUpdate = {};

      realTimeUpdate.EventIndex = reader.ReadUInt16();
      realTimeUpdate.SessionIndex = reader.ReadUInt16();
      realTimeUpdate.SessionType = reader.ReadBytes(1).readUInt8(0);
      realTimeUpdate.Phase = reader.ReadBytes(1).readUInt8(0);
      var sessionTime = reader.ReadFloat();
      realTimeUpdate.SessionTime = msToTime(sessionTime);
      var sessionEndTime = reader.ReadFloat();
      realTimeUpdate.SessionEndTime = msToTime(sessionEndTime);

      realTimeUpdate.FocusedCarIndex = reader.ReadInt32();
      focusedCarIndex= realTimeUpdate.FocusedCarIndex
      realTimeUpdate.ActiveCameraSet = ReadString(reader);
      cameraSetDefault = realTimeUpdate.ActiveCameraSet;
      realTimeUpdate.ActiveCamera = ReadString(reader);
      cameraDefault = realTimeUpdate.ActiveCamera;
      realTimeUpdate.CurrentHudPage = ReadString(reader);

      realTimeUpdate.IsReplayPlaying = reader.ReadBytes(1).readUInt8(0) > 0;
      if (realTimeUpdate.IsReplayPlaying) {
        realTimeUpdate.ReplaySessionTime = reader.ReadFloat();
        realTimeUpdate.ReplayRemainingTime = reader.ReadFloat();
      }

      realTimeUpdate.TimeOfDay = msToTime(reader.ReadFloat());
      realTimeUpdate.AmbientTemp = reader.ReadBytes(1).readUInt8(0);
      realTimeUpdate.TrackTemp = reader.ReadBytes(1).readUInt8(0);
      realTimeUpdate.Clouds = reader.ReadBytes(1).readUInt8(0) / 10.0;
      realTimeUpdate.RainLevel = reader.ReadBytes(1).readUInt8(0) / 10.0;
      realTimeUpdate.Wetness = reader.ReadBytes(1).readUInt8(0) / 10.0;

      realTimeUpdate.BestSessionLap = readLap(reader);

      //console.log(realTimeUpdate);

      //Send RealTimeUpdate to frontend
      io.emit("realTimeUpdate", realTimeUpdate);

      break;
    }
    case constants.InboundMessageTypes.REALTIME_CAR_UPDATE: {
      //console.log("REALTIME_CAR_UPDATE");
      let carUpdate = {};

      carUpdate.carIndex = reader.ReadUInt16();
      carUpdate.driverIndex = reader.ReadUInt16();
      carUpdate.driverCount = reader.ReadBytes(1).readUInt8(0);
      carUpdate.gear = reader.ReadBytes(1).readUInt8(0) - 1; //works R = -1, N = 0
      carUpdate.worldPosX = reader.ReadFloat();
      carUpdate.worldPosY = reader.ReadFloat();
      carUpdate.yaw = reader.ReadFloat();
      carUpdate.carLocationNo = reader.ReadBytes(1).readUInt8(0); //works
      carUpdate.kmh = reader.ReadUInt16(); //works
      carUpdate.position = reader.ReadUInt16(); //works
      carUpdate.cupPosition = reader.ReadUInt16(); //no clue what this means
      carUpdate.trackPosition = reader.ReadUInt16(); //no clue what this means
      carUpdate.splinePosition = reader.ReadFloat(); //no clue what this means
      carUpdate.laps = reader.ReadUInt16(); //works

      carUpdate.delta = reader.ReadUInt32(); //works (in ms??)
      carUpdate.delta = carUpdate.delta / 1000;
      carUpdate.bestSessionLap = readLap(reader);
      carUpdate.lastLap = readLap(reader);
      carUpdate.currentLap = readLap(reader);
      // ^ should be working???

      //console.log(carUpdate);
      //Send carUpdate to frontend
      let indexCarList = entryListCars.findIndex((x) => x.carIndex === carUpdate.carIndex);
      let indexUpdateList = carUpdates.findIndex((x) => x.carIndex === carUpdate.carIndex);
      if (indexCarList === -1 && entryListCars.length > 0) {
        entryListCars = [];
        requestEntryList();
      };
    
      //add previous car delta to cars?
      if (entryListCars.length > 0) {
        entryListCars[indexCarList].carUpdate = carUpdate;
        if (indexUpdateList === -1) {
          carUpdates.push(carUpdate);
          carUpdatesCounter++;
        }
      }
      
    
      if (entryListCarCount === carEntryCount && carUpdatesCounter === carEntryCount && entryListCars.length > 0){
        entryListCars.sort((a, b) => a.carUpdate.position > b.carUpdate.position);
        io.emit("realTimeCarUpdate", entryListCars);
        carUpdatesCounter = 0;
        carUpdates = [];
      }

      //Increment update counter until hit 30, send data every update
      //Reset to 0, 
      break;
    }
    case constants.InboundMessageTypes.TRACK_DATA: {
      //works
      console.log("Track Update");
      let cID = reader.ReadInt32();
      let trackData = {};

      trackData.TrackName = ReadString(reader);
      trackData.TrackId = reader.ReadInt32();
      trackData.TrackMeters = reader.ReadInt32();
      TrackMeters = trackData.TrackMeters > 0 ? trackData.TrackMeters : -1;

      trackData.CameraSets = {};

      var cameraSetCount = reader.ReadBytes(1).readUInt8(0);
      for (let camSet = 0; camSet < cameraSetCount; camSet++) {
        var camSetName = ReadString(reader);
        trackData.CameraSets[camSetName] = [];

        var cameraCount = reader.ReadBytes(1).readUInt8(0);
        for (let cam = 0; cam < cameraCount; cam++) {
          var cameraName = ReadString(reader);
          trackData.CameraSets[camSetName].push(cameraName);
        }
      }

      var hudPages = [];
      var hudPagesCount = reader.ReadBytes(1).readUInt8(0);
      for (let i = 0; i < hudPagesCount; i++) {
        hudPages.push(ReadString(reader));
      }
      trackData.HUDPages = hudPages;

      //console.log(trackData);
      //Send Track Data to frontend
      io.emit("trackData", trackData);
      break;
    }
    case constants.InboundMessageTypes.BROADCASTING_EVENT: {
      //console.log("Broadcasting Event")

      let broadcastingEvent = {};
      broadcastingEvent.type = reader.ReadBytes(1).readUInt8(0);
      broadcastingEvent.message = ReadString(reader);
      broadcastingEvent.timeMS = reader.ReadInt32();
      broadcastingEvent.carId = reader.ReadInt32();

      //console.log(broadcastingEvent);
      //Send Broadcasting Event to frontend
      io.emit("broadcastingEvent", broadcastingEvent);
      break;
    }
    default: {
      break;
    }
  }
});

//Functions

function readLap(reader) {
  //working
  let lap = {};
  lap.LaptimeMS = reader.ReadInt32();

  lap.CarIndex = reader.ReadUInt16();
  lap.DriverIndex = reader.ReadUInt16();

  let splitCount = reader.ReadBytes(1).readUInt8(0);
  let splits = [];
  for (let i = 0; i < splitCount; i++) {
    splits.push(reader.ReadInt32());
  }

  lap.splits = splits;

  lap.IsInvalid = reader.ReadBytes(1).readUInt8(0) > 0;
  lap.IsValidForBest = reader.ReadBytes(1).readUInt8(0) > 0;

  var isOutlap = reader.ReadBytes(1).readUInt8(0) > 0;
  var isInlap = reader.ReadBytes(1).readUInt8(0) > 0;

  if (isOutlap) lap.Type = "Outlap";
  else if (isInlap) lap.Type = "Inlap";
  else lap.Type = "Regular";

  while (lap.splits.Count < 3) {
    lap.splits.push(null);
  }

  for (let i = 0; i < lap.splits.Count; i++)
    if (lap.splits[i] == 255) lap.splits[i] = null;

  if (lap.LaptimeMS == 255) lap.LaptimeMS = null;

  return lap;
}

function ReadString(reader) {
  //works
  let length = reader.ReadUInt16();
  let bytes = reader.ReadBytes(length);
  return bytes.toString("utf8");
}

function WriteString(writer, string) {
  var bytes = toUTF8Array(string);
  writer.WriteUInt16(bytes.Length);
  writer.WriteBytes(bytes);
}

acc.on("listening", () => {
  const address = acc.address();
  console.log(`server listening ${address.address}:${address.port}`);
});

function handleError(err) {
  if (err) {
    console.log("ERROR");
    console.log(err);
  }
}

//Requests
const requestConnection = api.requestConnection(
  DISPLAY_NAME,
  CONNECTION_PASSWORD,
  COMMAND_PASSWORD
);

function requestDisconnect() {
  let writer = new binutils.BinaryWriter("little");

  writer.WriteBytes([
    constants.outboundMessageTypes.UNREGISTER_COMMAND_APPLICATION,
  ]);
  writer.WriteInt32(connectionId);

  acc.send(
    writer.ByteBuffer,
    0,
    writer.ByteBuffer.length,
    PORT,
    HOST,
    handleError
  );
}

//Make functions that returns stuff
function requestEntryList() {
  entryListCarCount = 0;
  carUpdatesCounter = 0;
  entryListCars = [];
  let writer = new binutils.BinaryWriter("little");

  writer.WriteBytes([constants.outboundMessageTypes.REQUEST_ENTRY_LIST]);
  writer.WriteInt32(connectionId);

  let request = writer.ByteBuffer;

  acc.send(request, 0, request.length, PORT, HOST, handleError);
}

function requestTrackData() {
  //works
  let writerTD = new binutils.BinaryWriter("little");

  writerTD.WriteBytes([constants.outboundMessageTypes.REQUEST_TRACK_DATA]);
  writerTD.WriteInt32(connectionId);

  let requestTrackData = writerTD.ByteBuffer;

  acc.send(
    requestTrackData,
    0,
    requestTrackData.length,
    PORT,
    HOST,
    handleError
  );
}

//Setting focus
function setFocus(carIndex) {
  focusedCarIndex = carIndex;
  setFocusInternal();
}

function setFocusCamera(carIndex, cameraSet, camera) {
  focusedCarIndex = carIndex;
  cameraSetDefault = cameraSet;
  cameraDefault = camera;
  setFocusInternal();
}

function setCamera(cameraSet, camera) {
  cameraSet = cameraSet;
  camera = camera;
  setFocusInternal(null);
}

function setFocusInternal() {
  let writer = new binutils.BinaryWriter("little");

  writer.WriteBytes([constants.outboundMessageTypes.CHANGE_FOCUS]);
  writer.WriteInt32(connectionId);

  console.log(focusedCarIndex);//test to see if index actually changes
  console.log(cameraSetDefault);//same as above really
  console.log(cameraDefault); //Changing camera but not racer??

  
  writer.WriteBytes([1]);
  writer.WriteUInt16(focusedCarIndex);
  
  writer.WriteBytes([0]);
  //writer.WriteBytes(0);
  //WriteString(writer, cameraSetDefault);
  //WriteString(writer, cameraDefault);
  

  requestFocusChange = writer.ByteBuffer;

  acc.send(
    requestFocusChange,
    0,
    requestFocusChange.length,
    PORT,
    HOST,
    handleError
  );
}

function requestInstantReplay(
  startSessionTime,
  durationMS,
  initialFocusedCarIndex = -1,
  initialCameraSet = "",
  initialCamera = ""
) {
  let writer = new binutils.BinaryWriter("little");

  writer.WriteBytes([constants.outboundMessageTypes.INSTANT_REPLAY_REQUEST]);
  writer.WriteInt32(connectionId);

  writer.WriteFloat(startSessionTime);
  writer.WriteFloat(durationMS);
  writer.WriteInt32(initialFocusedCarIndex);

  WriteString(writer, initialCameraSet);
  WriteString(writer, initialCamera);

  replayRequest = writer.ByteBuffer;

  acc.send(replayRequest, 0, replayRequest.length, PORT, HOST, handleError);
}

function requestHUDPage(hudPage) {
  let writer = new binutils.BinaryWriter("little");

  writer.WriteBytes([constants.outboundMessageTypes.CHANGE_HUD_PAGE]);
  writer.WriteInt32(connectionId);

  WriteString(writer, hudPage);

  hudPageRequest = writer.ByteBuffer;

  acc.send(hudPageRequest, 0, hudPageRequest.length, PORT, HOST, handleError);
}

function connect(host) {
  HOST = host;
  acc.send(
    requestConnection,
    0,
    requestConnection.length,
    PORT,
    HOST,
    handleError
  );
}

io.on("connection", (socket) => {
  console.log("Connected from browser...");

  socket.on("connectionIP", (ip) => {
    connect(ip);
  });

  socket.on("setCar", (car) => {
    setFocus(car);
  });

  socket.on("setCamera", (camera) => {
    setCamera(camera.cameraSet, camera.camera);
  });

  socket.on("setHudPage", (hudPage) => {
    requestHUDPage(hudPage);
  });

  socket.on("disconnect", () => {
    requestDisconnect();
  });

  socket.on("requestUpdate", () => {
    requestEntryList();
    requestTrackData();
  });
});

http.listen(6767, () => {
  console.log("Socket io server up and running");
});

////////////////////////////
function msToTime(s) {
  // Pad to 2 or 3 digits, default is 2
  function pad(n, z) {
    z = z || 2;
    return ("00" + n).slice(-z);
  }

  var ms = s % 1000;
  s = (s - ms) / 1000;
  var secs = s % 60;
  s = (s - secs) / 60;
  var mins = s % 60;
  var hrs = (s - mins) / 60;

  return pad(hrs) + ":" + pad(mins) + ":" + pad(secs) + "." + pad(ms, 3);
}


function toUTF8Array(str) {
  var utf8 = [];
  for (var i=0; i < str.length; i++) {
      var charcode = str.charCodeAt(i);
      if (charcode < 0x80) utf8.push(charcode);
      else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6), 
                    0x80 | (charcode & 0x3f));
      }
      else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12), 
                    0x80 | ((charcode>>6) & 0x3f), 
                    0x80 | (charcode & 0x3f));
      }
      // surrogate pair
      else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
                    | (str.charCodeAt(i) & 0x3ff))
          utf8.push(0xf0 | (charcode >>18), 
                    0x80 | ((charcode>>12) & 0x3f), 
                    0x80 | ((charcode>>6) & 0x3f), 
                    0x80 | (charcode & 0x3f));
      }
  }
  return utf8;
}