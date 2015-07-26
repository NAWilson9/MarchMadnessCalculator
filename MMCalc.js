/**
 * March Madness Calculator v1.0.1
 *
 * Created by Nick Wilson on 6/30/2015.
 *
 * This is a command line calculator used to calculate the historical win percentages
 * of two March Madness teams based on their seed values. I've implemented a 'smart'
 * caching feature. It will parse Washington Post pages for the data (as per the spec),
 * and then store it in a json file. Each subsequent use will read from the file, cutting
 * down the time it takes for each comparison considerably. Additionally, if the stored
 * data does not contain the most recent March Madness statistics and it should, it will
 * update the data regardless of whether the user has used the force command or not.
 */

//Required dependencies
var cheerio = require('cheerio');
var request = require('request');
var fs = require('fs');

//Global variables
var gameData;
var team1MainSeed;
var team2MainSeed;
var previous;
var previousSection;

//Benchmarking function (which is not being used in the final version of code, but something
//I made to test some stuff that was kind of neat.) I learned that ms is often not precise enough
//to test the majority of things here. Would have to use process.hrtime() (for Node.js)
//to be able to get time readings (relative to the previous hrtime call) in nanoseconds.
//I figured <= 1ms time difference between two different ways of doing things is imperceptible
//so I didn't bother, but it's something I'll look into in the future.
var bench = function(section){
    //First time run
    if(!previous){
        previous = new Date().getTime();
        previousSection = section;
    } else {
        var current = new Date().getTime();
        console.log((current - previous) + "ms elapsed from '" + previousSection + "' to '" + section + "'");
        previous = current;
        previousSection = section;
    }
};

//Initializes gameData array and scrapes web to populate gameData
var scrapeData = function(callback){
    //The base object for each cell in the 2D array
    var comparison = function() {
        this.totalPlayed =  0;
        this.totalWon = 0;
    };

    //Populates the gameData array
    gameData = new Array(16);
    for(var i = 0; i < 16; i++){
        gameData[i] = new Array(i+1);
        for(var j = 0; j < i+1; j++){
            gameData[i][j] = new comparison();
        }
    }

    //Setup for web scraping
    var baseUrl = 'http://apps.washingtonpost.com/sports/apps/live-updating-mens-ncaa-basketball-bracket/bracket/';
    var date = new Date();
    var requestCount = 1985;

    //Assigns the max year to check based on the current month (if it's after March)(0 based)
    if(date.getMonth() < 3) {
        date = date.getFullYear() - 1;
    } else {
        date = date.getFullYear();
    }

    //Populate statistics for every year available
    for(var k = 1985; k <= date; k++){
        var currentUrl = baseUrl + k + '/';
        //Makes request to Washington Post for each year
        request(currentUrl, function(error, response, html){
            if(error || response.statusCode != 200){
                console.error('There was a problem getting the web page.');
            } else{
                //Initializes the data for parsing
                var $ = cheerio.load(html);
                //Gets all of the games
                var brackets = $('tbody > tr');
                //Parses each game and updates game array
                brackets.each(function(){
                    var self = $(this);

                    //Extract data
                    var team1Seed = parseInt(self.find('.team1-seed').text());
                    var team2Seed = parseInt(self.find('.team2-seed').text());
                    var team1Score = parseInt(self.find('.team1-score').text());
                    var team2Score = parseInt(self.find('.team2-score').text());

                    //Update gameData array making sure the higher seed is used for first array position
                    if(team1Seed > team2Seed){
                        gameData[team1Seed - 1][team2Seed - 1].totalPlayed++;
                        if(team1Score > team2Score) {
                            gameData[team1Seed - 1][team2Seed - 1].totalWon++;
                        }
                    } else {
                        gameData[team2Seed - 1][team1Seed - 1].totalPlayed++;
                        if(team2Score > team1Score) {
                            gameData[team2Seed - 1][team1Seed - 1].totalWon++;
                        }
                    }
                });

                //All requests have completed and data has been parsed
                if(requestCount == date){
                    //Writes data to file and then calls the compare callback
                    fs.writeFile('data.json', JSON.stringify(gameData, null, 4), function(err) {
                        //Error when writing data to file
                        if (err) {
                            console.error('Error writing updated data to file.');
                        }
                        if (callback) {
                            callback(team1MainSeed, team2MainSeed);
                        } else {
                            console.log('Successfully retrieved and stored fresh game data.');
                        }
                    });
                } else {
                    requestCount++;
                }
            }
        })
    }
};

//Takes in two team seed values and writes the statistical outcome to console
var compare = function(team1Seed, team2Seed){
    //Makes sure the data exists
    if(!gameData || !gameData[team1Seed - 1] || !gameData[team1Seed - 1][team2Seed - 1]){
        console.error("Match data has become corrupt. Make the same query but with the 'force' parameter included to refresh the data");
        return;
    }
    //Retrieves the match data
    var matchData = gameData[team1Seed - 1][team2Seed - 1];

    //If there are no games in history
    if(matchData.totalPlayed === 0){
        console.log('No data for games with teams of these seeds.');
        return;
    }

    //Calculate percentages
    var team1WinPercentage = (matchData.totalWon / matchData.totalPlayed) * 100;
    var team2WinPercentage = 100 - team1WinPercentage;

    //Writes statistics
    console.log('Team 1 (seed: ' + team1Seed + ') win percentage: ' + team1WinPercentage.toFixed(2) + '%');
    console.log('Team 2 (seed: ' + team2Seed + ') win percentage: ' + team2WinPercentage.toFixed(2) + '%');

    //Writes advice based on win percentages
    if(team1WinPercentage > team2WinPercentage){
        console.log('You should pick team 1 (seed: ' + team1Seed + '). | Certainty: ' + matchData.totalPlayed);
    } else if(team1WinPercentage < team2WinPercentage){
        console.log('You should pick team 2 (seed: ' + team2Seed + '). | Certainty: ' + matchData.totalPlayed);
    } else {
        console.log('Both teams have the same win percentage. Flip a coin or something. | Certainty: ' + matchData.totalPlayed + '.');
    }
};

//Checks the match data file for data. If it exists, skip parsing it (unless the data needs to be updated), and call the callback function (which is compare)
var getData = function(force, callback){
    //Checks if the data file is present and has data
    fs.stat('data.json', function(err, stats){
        //If there was an error reading the stats of the file
        if(err && !err.toString().indexOf('ENOENT')) {
            console.error("There was a problem reading the data file. Make the same query but with the 'force' parameter included to refresh the data.");
            return;
        }

        //Checks if the file is empty, if it was last modified the previous year, if it was last modified before April, or if force is true to scrape data.
        //stats.size returns number of characters in file and 345.8 is just under the average amount of characters
        //per year so multiply by how many years (-1) there have been to approximate 'just under' file size
        if(force || !stats || stats.size < (345.8 * (new Date().getFullYear() - 1986)) || (stats.mtime.getFullYear() < new Date().getFullYear() && stats.mtime.getMonth() < 3) || (new Date().getMonth() > 2 && stats.mtime.getMonth() < 3)){
            //Data wasn't present or force was present so scrape data
            scrapeData(callback);
        } else {
            //Data is present so parse file
            fs.readFile('data.json', function(err, data) {
                //There was an error reading the file
                if(err) {
                    console.error("There was a problem reading the data file. Make the same query but with the 'force' parameter included to refresh the data.");
                } else {
                    gameData = JSON.parse(data);
                    //Calls the compare function since the data is now available
                    callback(team1MainSeed, team2MainSeed);
                }
            });
        }
    })
};

//Main function that runs everything.
(function(){
    var parameters = process.argv.slice(2, process.argv.length);
    var force = false;

    //Handles help argument
    //Matches additional forms of help param for user ease
    if(parameters.indexOf('?') > - 1 || parameters.indexOf('/?') > - 1 || parameters.indexOf('help') > - 1 || parameters.indexOf('/help') > - 1){
        console.log('###################################################################################');
        console.log('This is a March Madness win percentage fetcher. It takes in two team seed values');
        console.log('and returns the percent chance each one will win.');
        console.log('\n\tUsage: MMCalc.js {team 1 seed} {team 2 seed}');
        console.log('\tExample: MMCalc.js 2 4');
        console.log('\nOther available commands:');
        console.log("\t? : Shows the help text (you're currently viewing it).");
        console.log('\tforce : Forces the program to dump the old data and reacquire fresh data. Can');
        console.log('\t\t\t be used in conjunction with normal team seed parameters.');
        console.log('\n###################################################################################');
        return;
    }
    //Handles force argument
    if(parameters.indexOf('force') > - 1){
        force = true;
        parameters.splice(parameters.indexOf('force'), 1);
        if(!parameters.length){
            scrapeData();
            return;
        }
    }
    //Handles team arguments
    if(parameters.length < 2){
        console.error('Not enough or improper arguments entered.');
        return;
    } else if(parameters.length > 2) {
        console.error('Too many arguments entered.');
        return;
    } else {
        //Assigns the team with the higher seed to team1MainSeed
        if(parseInt(parameters[0]) > parseInt(parameters[1])){
            team1MainSeed = parameters[0];
            team2MainSeed = parameters[1];
        }
        else {
            team1MainSeed = parameters[1];
            team2MainSeed = parameters[0];
        }

        //Checks if inputs are a number and within acceptable range
        if(isNaN(team1MainSeed) || isNaN(team2MainSeed) || team1MainSeed < 1 || team1MainSeed > 16 || team2MainSeed < 1 || team2MainSeed > 16){
            console.error('Entered team seed is not an acceptable number.');
            return;
        }
    }

    //Checks if both teams are of the same seed. If they are, it's always a 50/50 chance so no need to retrieve data.
    if(team1MainSeed === team2MainSeed){
        console.log("Both seed values are the same so it's a 50/50 chance of either team wining.");
    } else {
        //Begin comparison process
        getData(force, compare);
    }
})();